// public/js/effets.js
// Anime un canvas en arriere-plan avec des colonnes de caracteres qui
// defilent, dans l'esprit "salle de controle / flux de donnees" — en
// opacite tres faible pour ne jamais géner la lecture du contenu au premier plan.

function demarrerFondCode(idCanvas, options = {}) {
  const canvas = document.getElementById(idCanvas);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const caracteres = "01アイウエオカキクケコサシスセソPNSGP".split("");
  const tailleCase = 16;
  const opaciteMax = options.opacite || 0.12;

  let colonnes, gouttes;

  function redimensionner() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    colonnes = Math.floor(canvas.width / tailleCase);
    gouttes = new Array(colonnes).fill(0).map(() => Math.random() * -50);
  }

  function dessiner() {
    ctx.fillStyle = "rgba(11, 16, 23, 0.12)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = tailleCase + "px monospace";

    for (let i = 0; i < colonnes; i++) {
      const caractere = caracteres[Math.floor(Math.random() * caracteres.length)];
      const x = i * tailleCase;
      const y = gouttes[i] * tailleCase;
      ctx.fillStyle = `rgba(63, 127, 176, ${opaciteMax})`;
      ctx.fillText(caractere, x, y);

      if (y > canvas.height && Math.random() > 0.975) {
        gouttes[i] = 0;
      }
      gouttes[i]++;
    }
  }

  redimensionner();
  window.addEventListener("resize", redimensionner);
  setInterval(dessiner, 60);
}
