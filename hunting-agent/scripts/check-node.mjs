// Runs automatically on `npm install` (preinstall) AND `npm run dev` (predev), so an
// unsupported Node is caught before either can fail or crash the dev server. Blocks with a
// friendly, actionable message. Supported: Node 20.19+, 22.12+ (recommended LTS), or 24+. NOT 21/23.
const [major, minor] = process.versions.node.split('.').map(Number);
const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24;

if (!ok) {
  const RED = '\x1b[31m', YEL = '\x1b[33m', CYN = '\x1b[36m', DIM = '\x1b[2m', RST = '\x1b[0m';
  console.error(`
${RED}✖ Node ${process.versions.node} is not supported by this workshop.${RST}

  Supported: ${YEL}Node 22.12+ (recommended LTS)${RST}, or 20.19+, or 24+.
  ${DIM}Vite 8 needs 20.19+ / 22.12+ — on older Node the dev server is unstable and crashes. Node 21 and 23 are also unsupported.${RST}

  Easiest fix — run the setup script for your OS from the project folder:
    ${CYN}macOS / Linux:${RST}  ./setup.sh
    ${CYN}Windows:${RST}        powershell -ExecutionPolicy Bypass -File setup.ps1

  Or, if you already use a Node version manager:
    ${CYN}volta:${RST}  volta install node@22.12.0
    ${CYN}nvm:${RST}    nvm install 22.12.0 && nvm use 22.12.0
    ${CYN}fnm:${RST}    fnm install 22.12.0 && fnm use 22.12.0
  ${DIM}(This folder pins 22.12.0 via .nvmrc and .node-version — with nvm or fnm you can just run 'nvm use' here.)${RST}
`);
  process.exit(1);
}
