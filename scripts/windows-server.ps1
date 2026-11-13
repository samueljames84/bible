param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('setup', 'start', 'stop')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$localDir = Join-Path $root '.local'
$statePath = Join-Path $localDir 'server.json'
$vitePath = Join-Path $root 'node_modules\vite\bin\vite.js'
$databasePath = Join-Path $root 'public\data\bible.sqlite'
$port = 8834

function Get-ServerProcess {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $pidValue = 0
    if (-not [int]::TryParse([string]$state.pid, [ref]$pidValue) -or $pidValue -le 0 -or
        -not $state.created -or -not $state.executable) {
        throw 'Invalid server state in .local\server.json. No process was stopped.'
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue"
    if (-not $process) {
        Remove-Item -LiteralPath $statePath
        return $null
    }
    if ($process.CreationDate.ToUniversalTime().Ticks.ToString() -ne $state.created -or
        $process.ExecutablePath -ne $state.executable -or
        $process.CommandLine -notlike "*`"$vitePath`"* preview *") {
        throw 'Saved process identity does not match the Bible reader. No process was stopped; inspect .local\server.json.'
    }
    return $process
}

function Stop-Reader {
    $process = Get-ServerProcess
    if (-not $process) {
        Write-Host 'Bible reader is already stopped.'
        return
    }
    Stop-Process -Id $process.ProcessId -ErrorAction Stop
    Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    if (Get-ServerProcess) { throw 'The Bible reader did not stop.' }
    Write-Host 'Bible reader stopped.'
}

function Get-NodeTools {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node -or -not $npm) {
        throw 'Install Node.js and npm, then run setup-local.bat.'
    }
    & $node.Source -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22 ? 0 : 1)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 20.19+ or 22.12+ is required (Node.js 21 is not supported).' }
    return @{ node = $node.Source; npm = $npm.Source }
}

function Assert-Inputs {
    if (-not (Test-Path -LiteralPath $databasePath)) {
        throw 'The Bible database is missing. Follow the import instructions in README.md.'
    }
    if (-not (Test-Path -LiteralPath $vitePath) -or
        -not (Test-Path -LiteralPath (Join-Path $root 'node_modules\sql.js\dist\sql-wasm.wasm'))) {
        throw 'Node dependencies are missing. Run setup-local.bat first.'
    }
}

function Build-Reader($npm) {
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw 'The web build failed. See the messages above.' }
}

try {
    if ($Action -eq 'stop') { Stop-Reader; exit 0 }

    $tools = Get-NodeTools
    if ($Action -eq 'setup') {
        if (-not (Test-Path -LiteralPath $vitePath) -or
            -not (Test-Path -LiteralPath (Join-Path $root 'node_modules\sql.js\dist\sql-wasm.wasm'))) {
            & $tools.npm ci
            if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Resolve the error and rerun setup-local.bat.' }
        }
        Assert-Inputs
        Build-Reader $tools.npm
        Write-Host 'Local setup complete. Run start_server.bat. Docker is not required.'
        exit 0
    }

    Assert-Inputs
    Stop-Reader
    Build-Reader $tools.npm

    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $port)
    $listener.ExclusiveAddressUse = $true
    try { $listener.Start() }
    catch { throw "Port $port is already in use or unavailable. No unrelated process was stopped." }
    finally { $listener.Stop() }

    New-Item -ItemType Directory -Path $localDir -Force | Out-Null
    $stdout = Join-Path $localDir 'stdout.log'
    $stderr = Join-Path $localDir 'stderr.log'
    $arguments = "`"$vitePath`" preview --host 0.0.0.0 --port $port --strictPort"
    $process = Start-Process -FilePath $tools.node -ArgumentList $arguments -WorkingDirectory $root `
        -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $identity = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
    if (-not $identity) { throw 'The reader exited at startup. See .local\stderr.log.' }
    try {
        @{ pid = $process.Id; created = $identity.CreationDate.ToUniversalTime().Ticks.ToString(); executable = $identity.ExecutablePath } |
            ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    } catch {
        Stop-Process -Id $process.Id -ErrorAction Stop
        throw
    }
    try {
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $process.Refresh()
            if ($process.HasExited) { throw 'The reader exited at startup. See .local\stderr.log.' }
            $ownedListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Where-Object { $_.OwningProcess -eq $process.Id }
            if ($ownedListener) {
                try {
                    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2
                    if ($response.StatusCode -eq 200 -and $response.Content -match '<title>Malayalam Bible Reader</title>') {
                        Write-Host "Bible reader is running at http://localhost:$port"
                        Write-Host 'Use stop_server.bat to stop it. Logs are in .local.'
                        exit 0
                    }
                } catch [System.Net.WebException] {
                    Write-Verbose $_.Exception.Message
                }
            }
            Start-Sleep -Seconds 1
        }
        throw 'The reader did not become ready. See .local\stderr.log.'
    } catch {
        try { Stop-Reader }
        catch { [Console]::Error.WriteLine("ERROR stopping failed startup: $($_.Exception.Message)") }
        throw
    }
} catch {
    [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
    exit 1
}
