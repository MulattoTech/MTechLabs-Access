(() => {
  'use strict';
  const input = document.querySelector('#search');
  const controls = [...document.querySelectorAll('.filter')];
  const cards = [...document.querySelectorAll('.card')];
  const sections = [...document.querySelectorAll('[data-section]')];
  const empty = document.querySelector('#empty');
  let current = 'all';
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
})();
