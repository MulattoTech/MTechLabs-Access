param(
  [Parameter(Mandatory = $true)]
  [string]$StateDirectory
)

$ErrorActionPreference = 'Stop'
$state = (Resolve-Path -LiteralPath $StateDirectory).Path
$venv = Join-Path $state 'math-venv'
if (Test-Path -LiteralPath $venv) {
  throw 'The isolated math environment already exists. Inspect it before choosing an upgrade or repair.'
}

$python = (Get-Command python -ErrorAction Stop).Source
& $python -m venv $venv
if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment creation failed.' }
$isolated = Join-Path $venv 'Scripts\python.exe'
& $isolated -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'requirements-math.txt')
if ($LASTEXITCODE -ne 0) { throw 'SymPy installation failed. The partial environment was left for inspection.' }
& $isolated -I -c 'import sympy; print(sympy.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'SymPy self-check failed.' }
Write-Output 'MTerm-CLI isolated math dependency is ready.'
