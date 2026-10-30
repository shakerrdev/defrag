param(
  [switch]$Watch,
  [switch]$Launch,
  [string]$Cs2Path
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$AddonName = 'defrag'
$RepoZip = 'https://github.com/shakerrdev/defrag/archive/refs/heads/main.zip'
$PnpmVersion = '10.28.0'
$MinNode = [version]'22.18.0'
$Home_ = Join-Path $env:LOCALAPPDATA 'defrag'
$Tools = Join-Path $Home_ 'tools'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Info($text) { Write-Host "    $text" }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }

function Get-Repo {
  if ($PSScriptRoot) {
    $candidate = Split-Path $PSScriptRoot -Parent
    if (Test-Path (Join-Path $candidate 'pnpm-workspace.yaml')) {
      Ok "using the repo at $candidate"
      return $candidate
    }
  }
  $target = Join-Path $Home_ 'repo'
  $zip = Join-Path $Home_ 'defrag-main.zip'
  $unpack = Join-Path $Home_ 'unpack'
  New-Item -ItemType Directory -Force $Home_ | Out-Null
  Info "downloading the latest version from GitHub"
  Invoke-WebRequest $RepoZip -OutFile $zip -UseBasicParsing
  if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpack)
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Move-Item (Join-Path $unpack 'defrag-main') $target
  Remove-Item $unpack, $zip -Recurse -Force
  Ok "downloaded to $target"
  return $target
}

function Get-NodeDir {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) {
    $version = [version]((& $node.Source --version).TrimStart('v'))
    if ($version -ge $MinNode) {
      Ok "using installed Node $version"
      return Split-Path $node.Source -Parent
    }
    Info "installed Node $version is older than $MinNode, using a private copy instead"
  }
  $arch = 'x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  $existing = Get-ChildItem $Tools -Directory -Filter "node-v*-win-$arch" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($existing) {
    Ok "using Node from $($existing.FullName)"
    return $existing.FullName
  }
  $release = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1
  $name = "node-$($release.version)-win-$arch"
  $zip = Join-Path $Tools "$name.zip"
  New-Item -ItemType Directory -Force $Tools | Out-Null
  Info "downloading Node $($release.version) (LTS)"
  Invoke-WebRequest "https://nodejs.org/dist/$($release.version)/$name.zip" -OutFile $zip -UseBasicParsing
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $Tools)
  Remove-Item $zip -Force
  $dir = Join-Path $Tools $name
  Ok "Node installed to $dir (private, nothing changed system-wide)"
  return $dir
}

function Install-Pnpm($nodeDir) {
  $prefix = Join-Path $Tools 'pnpm'
  $cli = Join-Path $prefix 'node_modules\pnpm\bin\pnpm.cjs'
  $package = Join-Path $prefix 'node_modules\pnpm\package.json'
  $current = $null
  if (Test-Path $package) { $current = (Get-Content $package -Raw | ConvertFrom-Json).version }
  if ($current -ne $PnpmVersion) {
    Info "installing pnpm $PnpmVersion"
    & (Join-Path $nodeDir 'npm.cmd') install --prefix $prefix "pnpm@$PnpmVersion" --no-fund --no-audit --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw 'installing pnpm failed' }
  }
  $bin = Join-Path $Tools 'bin'
  New-Item -ItemType Directory -Force $bin | Out-Null
  Set-Content (Join-Path $bin 'pnpm.cmd') "@`"$nodeDir\node.exe`" `"$cli`" %*" -Encoding ASCII
  $env:PATH = "$bin;$nodeDir;$env:PATH"
  Ok "pnpm $PnpmVersion ready"
}

function Find-Cs2 {
  if ($Cs2Path) {
    if (Test-Path (Join-Path $Cs2Path 'game\bin\win64\cs2.exe')) { return (Resolve-Path $Cs2Path).Path }
    throw "no cs2.exe under $Cs2Path\game\bin\win64"
  }
  $steam = $null
  foreach ($key in 'HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam') {
    $props = Get-ItemProperty $key -ErrorAction SilentlyContinue
    if ($props.SteamPath) { $steam = $props.SteamPath; break }
    if ($props.InstallPath) { $steam = $props.InstallPath; break }
  }
  if (-not $steam) { $steam = "${env:ProgramFiles(x86)}\Steam" }
  $steam = $steam -replace '/', '\'
  $libraries = @($steam)
  $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
  if (Test-Path $vdf) {
    foreach ($match in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
      $libraries += $match.Groups[1].Value -replace '\\\\', '\'
    }
  }
  foreach ($library in ($libraries | Select-Object -Unique)) {
    $manifest = Join-Path $library 'steamapps\appmanifest_730.acf'
    if (-not (Test-Path $manifest)) { continue }
    $installDir = 'Counter-Strike Global Offensive'
    $found = [regex]::Match((Get-Content $manifest -Raw), '"installdir"\s+"([^"]+)"')
    if ($found.Success) { $installDir = $found.Groups[1].Value }
    $dir = Join-Path $library "steamapps\common\$installDir"
    if (Test-Path (Join-Path $dir 'game\bin\win64\cs2.exe')) { return $dir }
  }
  throw 'CS2 not found in any Steam library. Run again with -Cs2Path "<folder that contains game and content>".'
}

function Write-SpikeConfig($cs2) {
  $cfg = Join-Path $cs2 'game\csgo\cfg\defrag_spike.cfg'
  $lines = @(
    '// written by the defrag setup script: loads the bot peek spike into the running map',
    'sv_cheats 1',
    'ent_create point_script targetname defrag_spike cs_script scripts/spike.vjs'
  )
  Set-Content $cfg $lines -Encoding ASCII
  Ok "wrote $cfg"
}

function Compile-Scripts($cs2, $addonContent) {
  $compiler = Join-Path $cs2 'game\bin\win64\resourcecompiler.exe'
  if (-not (Test-Path $compiler)) { return }
  $log = Join-Path $Home_ 'resourcecompiler.log'
  foreach ($script in Get-ChildItem (Join-Path $addonContent 'scripts') -Filter *.js) {
    $ErrorActionPreference = 'Continue'
    & $compiler -i $script.FullName *> $log
    $ErrorActionPreference = 'Stop'
    $compiled = Join-Path $cs2 "game\csgo_addons\$AddonName\scripts\$($script.BaseName).vjs_c"
    if (Test-Path $compiled) {
      Ok "compiled $($script.Name)"
    } else {
      Warn "couldn't precompile $($script.Name) (see $log); the tools compile it when it is first loaded"
    }
  }
}

function Main {
  Write-Host 'defrag setup' -ForegroundColor White

  Step 'Finding CS2'
  $cs2 = Find-Cs2
  Ok $cs2
  $hasTools = (Test-Path (Join-Path $cs2 'content\csgo')) -or (Test-Path (Join-Path $cs2 'game\bin\win64\resourcecompiler.exe'))
  if ($hasTools) {
    Ok 'Counter-Strike 2 Workshop Tools are installed'
  } else {
    Warn 'Counter-Strike 2 Workshop Tools are missing. In Steam: Library > Counter-Strike 2 > Properties > DLC >'
    Warn 'tick "Counter-Strike 2 Workshop Tools", let it download, then run this again.'
  }

  Step 'Getting the code'
  $repo = Get-Repo

  Step 'Node and pnpm'
  $nodeDir = Get-NodeDir
  Install-Pnpm $nodeDir

  Step 'Installing dependencies'
  Push-Location $repo
  try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }

    Step "Creating the '$AddonName' addon"
    $addonContent = Join-Path $cs2 "content\csgo_addons\$AddonName"
    $addonGame = Join-Path $cs2 "game\csgo_addons\$AddonName"
    New-Item -ItemType Directory -Force (Join-Path $addonContent 'scripts'), (Join-Path $addonContent 'maps'), $addonGame | Out-Null
    Ok $addonContent

    Step 'Building the map scripts'
    $env:CS2_ADDON_DIR = $addonContent
    pnpm --filter @defrag/addon build
    if ($LASTEXITCODE -ne 0) { throw 'building the scripts failed' }
    if ($hasTools) { Compile-Scripts $cs2 $addonContent }
    Write-SpikeConfig $cs2

    Step 'Done'
    Info '1. Start Counter-Strike 2 Workshop Tools and pick the defrag addon.'
    Info '2. In the console: map de_dust2   (any map with spawns and a nav mesh works)'
    Info '3. Join CT, then in the console: exec defrag_spike'
    Info '4. Chat should say "[defrag] spike loaded". Type !help in chat.'
    Info 'No message? Place a point_script with cs_script = scripts/spike.vjs in a map in Hammer instead (addon\README.md).'
    Info "While editing the scripts, run $(Join-Path $repo 'watch.cmd') to rebuild and copy them on every save."

    if ($Watch) {
      Step 'Watching addon/src (Ctrl+C to stop)'
      pnpm --filter @defrag/addon watch
      return
    }

    if ($hasTools) {
      $start = $Launch
      if (-not $start) { $start = (Read-Host "`nStart the Workshop Tools now? [Y/n]") -notmatch '^[nN]' }
      if ($start) {
        Start-Process (Join-Path $cs2 'game\bin\win64\cs2.exe') -ArgumentList '-tools', '-addon', $AddonName
        Ok 'starting CS2 Workshop Tools'
      }
    }
  } finally {
    Pop-Location
  }
}

try {
  Main
} catch {
  Write-Host "`nSetup failed: $($_.Exception.Message)" -ForegroundColor Red
}
