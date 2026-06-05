Set-Location $PSScriptRoot
if (!(Test-Path .env)) { Copy-Item .env.example .env }
if (!(Test-Path node_modules)) { npm install }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Fallo el build" }
npm start
