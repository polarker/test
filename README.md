1. Launch a local dev node with such configurations: https://wiki.alephium.org/Devnet-Guide.html#configuration
2. Run `npm link && npm run compile` in `alephium-js` with branch `contracts`
3. Run `npm link alephium-js` for this project
4. Run `npx tsc && node dist/app.js`