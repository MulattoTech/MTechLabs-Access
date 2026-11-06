(() => {
  'use strict';
  const input = document.querySelector('#search');
  const controls = [...document.querySelectorAll('.filter')];
  const sections = [...document.querySelectorAll('[data-section]')];
  const empty = document.querySelector('#empty');
  let current = 'all';
  let cards = [];

  const node = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  };
  function renderCard(item) {
    const card = node('article', 'card');
    card.id = item.id + '-card';
    card.dataset.category = item.category;
    card.dataset.search = item.search || '';
    const top = node('div', 'card-top');
    top.append(node('span', 'glyph ' + (item.tone || ''), item.glyph || '•'));
    top.append(node('span', 'status ' + (item.statusTone || ''), item.status || ''));
    card.append(top, node('h3', '', item.name), node('p', '', item.description));
    const actions = node('div', 'card-actions');
    for (const [label, href, secondary] of item.actions || []) {
      if (typeof href !== 'string' || !(/^(https:\/\/|\/|rustdesk:\/\/\/)/.test(href))) continue;
      const a = node('a', secondary ? 'link-secondary' : 'link-primary');
      a.textContent = label + ' ';
      a.append(node('span', '', href.startsWith('https://') ? '↗' : '→'));
      a.href = href;
      if (href.startsWith('https://github.com/')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      actions.append(a);
    }
    card.append(actions);
    return card;
  }
  function render() {
    const q = input.value.toLowerCase().trim();
    let count = 0;
    for (const card of cards) {
      const matchGroup = current === 'all' || card.dataset.category === current;
      const matchText = !q || (card.dataset.search + ' ' + card.textContent).toLowerCase().includes(q);
      const visible = matchGroup && matchText;
      card.toggleAttribute('data-hidden', !visible);
      if (visible) count++;
    }
    for (const section of sections) {
      section.classList.toggle('hidden', ![...section.querySelectorAll('.card')].some(c => !c.hasAttribute('data-hidden')));
    }
    empty.classList.toggle('hidden', count !== 0);
  }
  for (const control of controls) control.addEventListener('click', () => {
    current = control.dataset.filter;
    for (const button of controls) {
      const active = button === control;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    render();
  });
  input.addEventListener('input', render);
  function setTime() {
    document.querySelector('#clock').textContent = new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(new Date());
  }
  setTime();
  setInterval(setTime, 30_000);

  async function loadDirectory() {
    const response = await fetch('/admin/access/api/homepage', {credentials:'same-origin',cache:'no-store'});
    if (!response.ok) throw new Error('Directory could not be loaded.');
    const data = await response.json();
    if (!Array.isArray(data.cards)) throw new Error('Invalid directory response.');
    for (const group of document.querySelectorAll('[data-cards]')) group.replaceChildren();
    for (const item of data.cards) {
      const group = document.querySelector('[data-cards="' + item.category + '"]');
      if (group) group.append(renderCard(item));
    }
    cards = [...document.querySelectorAll('.card')];
    document.querySelector('#manage-visibility').hidden = !data.owner;
    document.querySelector('#loading').classList.add('hidden');
    input.disabled = false;
    render();
  }
  loadDirectory().catch(() => {
    document.querySelector('#loading').classList.add('hidden');
    document.querySelector('#directory-error').classList.remove('hidden');
  });
})();
