const app = document.querySelector("#app");

const manifestSummary = {
  name: "DynApp Boilerplate",
  permissions: [],
  source: "src/",
  output: "dist/",
};

app.innerHTML = `
  <main class="shell">
    <section class="intro">
      <img src="../public/icon.svg" alt="" class="icon" />
      <div>
        <p class="eyebrow">DynApp starter</p>
        <h1>${manifestSummary.name}</h1>
        <p class="lede">
          Start here for a small, inspectable DynApp with source, docs, scripts,
          built output, and no shell permissions.
        </p>
      </div>
    </section>
    <section class="facts" aria-label="Package facts">
      <article>
        <span>Permissions</span>
        <strong>${manifestSummary.permissions.length}</strong>
      </article>
      <article>
        <span>Source</span>
        <strong>${manifestSummary.source}</strong>
      </article>
      <article>
        <span>Build output</span>
        <strong>${manifestSummary.output}</strong>
      </article>
    </section>
  </main>
`;
