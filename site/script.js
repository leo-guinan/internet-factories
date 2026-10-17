document.documentElement.classList.add('js');
const reveal = () => {
  const items = document.querySelectorAll('.metric-card, .path-card, .pipeline-step, .network-item');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach((item) => observer.observe(item));
};
if ('IntersectionObserver' in window) reveal();

const header = document.querySelector('.site-header');
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const current = window.scrollY;
  header.classList.toggle('scrolled', current > 20);
  if (current > 120 && current > lastScroll) header.classList.add('quiet');
  else header.classList.remove('quiet');
  lastScroll = current;
}, { passive: true });
