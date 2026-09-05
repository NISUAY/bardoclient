(() => {
  'use strict';

  const pagina = window.location.pathname.split('/').pop().toLowerCase() || 'index.html';
  const porId = id => document.getElementById(id);
  const navegar = archivo => { window.location.href = archivo; };

  function iniciarLogin() {
    const btnGuest = porId('btn-guest-mode');
    const btnIngresar = porId('btn-login');
    const btnVolver = porId('back-to-methods');
    const metodos = porId('auth-methods');
    const formulario = porId('nick-form');
    const nick = porId('input-nick');

    if (!btnGuest || !btnIngresar || !btnVolver || !metodos || !formulario || !nick) return;

    btnGuest.addEventListener('click', () => {
      metodos.classList.add('hidden');
      formulario.classList.remove('hidden');
      btnVolver.classList.remove('hidden');
      nick.focus();
    });

    btnVolver.addEventListener('click', () => {
      formulario.classList.add('hidden');
      btnVolver.classList.add('hidden');
      metodos.classList.remove('hidden');
    });

    // Sólo normaliza la maqueta: la validación y el guardado llegarán en la fase Core.
    nick.addEventListener('input', () => {
      nick.value = nick.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    });
    btnIngresar.addEventListener('click', () => navegar('inicio.html'));
  }

  function iniciarInicio() {
    const btnAjustes = porId('btn-settings');
    btnAjustes?.addEventListener('click', () => navegar('ajustes.html'));
  }

  function iniciarAjustes() {
    const btnVolver = porId('back-from-settings');
    const sliderRam = document.querySelector('.ram-slider');
    const campoRam = document.querySelector('.ram-number-field');

    btnVolver?.addEventListener('click', () => navegar('inicio.html'));
    if (!sliderRam || !campoRam) return;
    sliderRam.addEventListener('input', () => {
      campoRam.value = `${sliderRam.value}.0GB`;
    });
  }

  if (pagina === 'index.html') iniciarLogin();
  else if (pagina === 'inicio.html') iniciarInicio();
  else if (pagina === 'ajustes.html') iniciarAjustes();
})();
