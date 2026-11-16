import { createApp } from './app.js';

const port = Number(process.env.API_PORT || 3001);
const { app, db } = createApp();
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Meetups API ready at http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
