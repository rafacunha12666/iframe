const pingBtn = document.getElementById('pingBtn');
const pingResult = document.getElementById('pingResult');

pingBtn.addEventListener('click', async () => {
  pingResult.textContent = '...';
  try {
    const res = await fetch('/health');
    pingResult.textContent = res.ok ? 'OK' : 'Falhou';
  } catch (err) {
    pingResult.textContent = 'Erro';
  }
});
