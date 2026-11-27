// The Today page puts the brief as charts (brief.js) and the Weekly Recap (recap.js) on one page.
// The recap leads on weekends, when there's no new session to brief; on weekdays it sits at the bottom.
(function () {
  const day = new Date().getDay();
  const weekend = day === 0 || day === 6;
  const box = document.getElementById("today"), recap = document.getElementById("recap-sec");
  if (!box || !recap) return;
  if (weekend) box.prepend(recap);
  else box.append(recap);
  const chip = document.querySelector('.today-jump a[href="#recap"]');
  if (chip) {
    chip.href = "#recap-sec";
    if (weekend) chip.parentElement.prepend(chip);
  }
  // Old links to brief.html and recap.html land on their section once the page has drawn
  if (location.hash) setTimeout(() => { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }, 600);
})();
