"""Constrained SymPy calculator for MTerm-CLI. Input is one JSON line on stdin.

This process runs with python -I. It never evaluates Python source, imports
client-selected modules, reads repository files, or invokes a shell.
"""
import ast
import json
import sys
from decimal import Decimal, InvalidOperation, getcontext


def respond(value):
    print(json.dumps(value, ensure_ascii=False, separators=(',', ':')))


try:
    import sympy as s
except ImportError:
    respond({'error': 'SymPy is not installed in the configured isolated Python environment.'})
    sys.exit(0)


FUNCTIONS = {
    'sin': s.sin, 'cos': s.cos, 'tan': s.tan, 'asin': s.asin,
    'acos': s.acos, 'atan': s.atan, 'sqrt': s.sqrt, 'log': s.log,
    'ln': s.log, 'exp': s.exp, 'abs': s.Abs, 'simplify': s.simplify,
}


def expression(source):
    if not isinstance(source, str) or len(source) > 500:
        raise ValueError('Expression must contain 1 to 500 characters.')
    tree = ast.parse(source.replace('^', '**'), mode='eval')
    nodes = list(ast.walk(tree))
    if len(nodes) > 100:
        raise ValueError('Expression is too complex.')

    def convert(node, depth=0):
        if depth > 24:
            raise ValueError('Expression is too deep.')
        if isinstance(node, ast.Expression):
            return convert(node.body, depth + 1)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            number = str(node.value)
            if len(number) > 80:
                raise ValueError('Numeric literal is too large.')
            return s.Rational(number)
        if isinstance(node, ast.Name):
            if node.id == 'pi':
                return s.pi
            if node.id == 'E':
                return s.E
            if node.id == 'I':
                return s.I
            if not node.id.isascii() or not node.id.isidentifier() or len(node.id) > 16 or node.id.startswith('_'):
                raise ValueError('Invalid symbol name.')
            return s.Symbol(node.id)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = convert(node.operand, depth + 1)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp):
            left = convert(node.left, depth + 1)
            right = convert(node.right, depth + 1)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.Pow):
                if not right.is_number or right.is_real is not True:
                    raise ValueError('Exponent must be a real number.')
                try:
                    if abs(float(right)) > 24:
                        raise ValueError('Exponent magnitude must be at most 24.')
                except (TypeError, OverflowError):
                    raise ValueError('Exponent is too large.')
                return left ** right
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS and not node.keywords:
            if len(node.args) != 1:
                raise ValueError('Functions accept exactly one argument.')
            return FUNCTIONS[node.func.id](convert(node.args[0], depth + 1))
        raise ValueError('Only numbers, symbols, arithmetic, and approved functions are supported.')

    return convert(tree)


UNITS = {
    'm': ('length', '1'), 'km': ('length', '1000'), 'cm': ('length', '.01'),
    'mm': ('length', '.001'), 'mi': ('length', '1609.344'),
    'ft': ('length', '.3048'), 'in': ('length', '.0254'),
    'kg': ('mass', '1'), 'g': ('mass', '.001'), 'lb': ('mass', '.45359237'),
    'oz': ('mass', '.028349523125'),
    's': ('time', '1'), 'min': ('time', '60'), 'h': ('time', '3600'),
    'day': ('time', '86400'),
    'K': ('temperature', '1'), 'C': ('temperature', '1'), 'F': ('temperature', '1'),
}


def convert_units(payload):
    source = payload.get('from')
    target = payload.get('to')
    if source not in UNITS or target not in UNITS or UNITS[source][0] != UNITS[target][0]:
        raise ValueError('Unit pair is unsupported or dimensionally incompatible.')
    value = Decimal(str(payload.get('value')))
    if not value.is_finite() or len(value.as_tuple().digits) > 80:
        raise ValueError('A finite number of at most 80 digits is required.')
    if source in ('C', 'F', 'K'):
        kelvin = value if source == 'K' else value + Decimal('273.15') if source == 'C' else (value - 32) * 5 / 9 + Decimal('273.15')
        result = kelvin if target == 'K' else kelvin - Decimal('273.15') if target == 'C' else (kelvin - Decimal('273.15')) * 9 / 5 + 32
    else:
        result = value * Decimal(UNITS[source][1]) / Decimal(UNITS[target][1])
    return {'value': format(result.normalize(), 'f'), 'from': source, 'to': target, 'dimension': UNITS[source][0]}


def main(payload):
    if not isinstance(payload, dict):
        raise ValueError('A JSON object is required.')
    operation = payload.get('operation')
    if operation == 'convert_units':
        return convert_units(payload)
    if operation == 'evaluate':
        precision = payload.get('precision', 30)
        if type(precision) is not int or not 8 <= precision <= 100:
            raise ValueError('Precision must be an integer from 8 to 100.')
        value = s.simplify(expression(payload.get('expression')))
        return {'exact': str(value)[:2000], 'approximate': str(s.N(value, precision))[:2000], 'precision': precision}
    if operation == 'solve':
        variable = payload.get('variable')
        if not isinstance(variable, str) or not variable.isascii() or not variable.isidentifier() or len(variable) > 16:
            raise ValueError('A valid variable name is required.')
        equation = payload.get('equation')
        if not isinstance(equation, str) or len(equation) > 500 or equation.count('=') > 1:
            raise ValueError('Supply one equation no longer than 500 characters.')
        left, sep, right = equation.partition('=')
        roots = s.solve(s.Eq(expression(left), expression(right if sep else '0')), s.Symbol(variable))
        return {'variable': variable, 'solutions': [str(v)[:500] for v in roots[:32]], 'truncated': len(roots) > 32}
    if operation == 'verify':
        difference = s.simplify(expression(payload.get('left')) - expression(payload.get('right')))
        return {'equivalent': difference == 0, 'difference': str(difference)[:2000]}
    raise ValueError('Unknown mathematical operation.')


try:
    request = sys.stdin.buffer.read(4097)
    if len(request) > 4096:
        raise ValueError('Mathematics request is too large.')
    getcontext().prec = 60
    respond({'ok': True, 'result': main(json.loads(request))})
except (ValueError, TypeError, SyntaxError, OverflowError, ZeroDivisionError, InvalidOperation) as exc:
    respond({'error': str(exc)[:300]})
except Exception:
    respond({'error': 'The calculation could not be completed.'})
