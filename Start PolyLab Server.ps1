$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$distIndex = Join-Path $projectDir "dist\index.html"

if (-not (Test-Path $distIndex)) {
  exit 1
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  exit 1
}

Start-Process -FilePath $nodeCmd.Source -ArgumentList "`"$projectDir\server.mjs`"" -WorkingDirectory $projectDir -WindowStyle Hidden
