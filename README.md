# Hello Web

AI Gang's web deployment-target boilerplate — a minimal, real,
independently runnable and deployable Express web app, generalizing the
pattern V1's `hello-desktop` proved for desktop.

- `npm install && npm start` runs it locally (default `http://localhost:3000`).
- `npm test` runs its test suite (`node --test`).
- `docker compose up --build` builds and runs it in a container.

This is scaffolded into a new project by
`scripts/init-repo.sh --deployment web`, so a new web project begins from
this working baseline instead of an empty repository — see
`setup/graphs/deployment-target-boilerplate.graph.yaml` for the same
selection represented as an initialization graph node.

`projects/hello-web/` is the checked-in, running reference instance of this
same boilerplate (paralleling `projects/hello-desktop/`'s role for desktop)
— exercise it directly there rather than modifying this template in place.

Replace `public/index.html`, `server.js`, and this README with your
project's own content once scaffolded.
