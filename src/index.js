import { buildServer } from './server.js';

let server;
try {
  server = buildServer();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { app, config, notes } = server;
app.listen(config.port, () => {
  console.log(`Kapyiŋi is running on ${config.appUrl}`);
  for (const n of notes) console.log(n);
});
