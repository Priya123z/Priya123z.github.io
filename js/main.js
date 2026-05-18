/* ============================================================
   SCROLL REVEAL — Intersection Observer
   ============================================================ */
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08, rootMargin: "0px 0px -50px 0px" }
);

document.querySelectorAll("[data-reveal]").forEach((el) => {
  revealObserver.observe(el);
});

/* ============================================================
   NAV — scroll state + active link
   ============================================================ */
const nav = document.getElementById("nav");
const sections = document.querySelectorAll("section[id]");
const navLinks = document.querySelectorAll(".nav-links a");

let scrollY = window.scrollY;

function updateNav() {
  scrollY = window.scrollY;

  // Solid background after hero
  if (scrollY > 60) {
    nav.classList.add("scrolled");
  } else {
    nav.classList.remove("scrolled");
  }

  // Active link
  let current = "";
  sections.forEach((section) => {
    const top = section.offsetTop - 100;
    if (scrollY >= top) current = section.getAttribute("id");
  });

  navLinks.forEach((link) => {
    link.classList.toggle(
      "active",
      link.getAttribute("href") === `#${current}`
    );
  });
}

window.addEventListener("scroll", updateNav, { passive: true });
updateNav();

/* ============================================================
   SCROLL HINT — fade out on scroll
   ============================================================ */
const scrollHint = document.querySelector(".scroll-hint");
if (scrollHint) {
  window.addEventListener(
    "scroll",
    () => {
      scrollHint.style.opacity = scrollY > 80 ? "0" : "1";
    },
    { passive: true }
  );
}

/* ============================================================
   SMOOTH SCROLL for anchor links
   ============================================================ */
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (e) => {
    const target = document.querySelector(anchor.getAttribute("href"));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

/* ============================================================
   STAGGER card children inside bento when parent reveals
   ============================================================ */
const bento = document.querySelector(".bento");
if (bento) {
  const bentoObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        const cards = bento.querySelectorAll(".bento-card");
        cards.forEach((card, i) => {
          card.style.transitionDelay = `${i * 0.08}s`;
          card.style.opacity = "0";
          card.style.transform = "translateY(20px)";
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              card.style.transition =
                `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 0.08}s,
                 transform 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 0.08}s,
                 border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s cubic-bezier(0.16,1,0.3,1)`;
              card.style.opacity = "1";
              card.style.transform = "translateY(0)";
            });
          });
        });
        bentoObserver.disconnect();
      }
    },
    { threshold: 0.1 }
  );
  bentoObserver.observe(bento);
}
