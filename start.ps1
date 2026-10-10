param(
    [switch]$NoBrowser,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$backendProcess = $null
$frontendProcess = $null
$exitCode = 0
$logDirectory = Join-Path $PSScriptRoot '.logs'
$pythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

function Assert-FreePort([int]$Port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Server.ExclusiveAddressUse = $true
        $listener.Start()
    } catch {
        throw "端口 $Port 已被占用。请先退出已运行的程序，再重新启动。"
    } finally {
        $listener.Stop()
    }
}

function Find-Python {
    $candidates = @()
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        $installed = & $launcher.Source -0p
        foreach ($line in $installed) {
            if ($line -match '^\s*-(?:V:)?3\.(?:10|11|12)\s+\*?\s*(.+python\.exe)\s*$') {
                $candidates += $Matches[1].Trim()
            }
        }
    }
    $defaultPython = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($defaultPython -and $defaultPython.Source -notlike '*\WindowsApps\*') {
        $candidates += $defaultPython.Source
    }
    $conda = Get-Command conda.exe -ErrorAction SilentlyContinue
    if ($conda) {
        $condaRoot = Split-Path (Split-Path $conda.Source -Parent) -Parent
        $candidates += Join-Path $condaRoot 'python.exe'
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $candidate) {
            & $candidate -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] < (3,13) else 1)'
            if ($LASTEXITCODE -eq 0) { return $candidate }
        }
    }
    throw '未找到 Python 3.10～3.12。请先安装 Python 3.11 或 3.12（包含 pip），然后重新双击启动。'
}

function Wait-Service([string]$Url, [System.Diagnostics.Process]$Process, [string]$Name) {
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            throw "$Name 启动失败，请查看 $logDirectory 中的日志。"
        }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch {
            Start-Sleep -Milliseconds 400
        }
    }
    throw "$Name 启动超时，请查看 $logDirectory 中的日志。"
}

try {
    Write-Host '正在启动单峰拟合工具…' -ForegroundColor Cyan
    Assert-FreePort 5175
    Assert-FreePort 5176

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $node -or -not $npm) { throw '请先安装 Node.js 18 或更高版本（包含 npm），然后重新启动。' }
    & $node.Source -e 'process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)'
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 版本过低，请安装 Node.js 18 或更高版本。' }

    if (-not (Test-Path -LiteralPath $pythonPath)) {
        $basePython = Find-Python
        Write-Host "首次启动：正在创建项目 Python 环境（$basePython）…"
        & $basePython -m venv (Join-Path $PSScriptRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw '创建 Python 环境失败，请检查上方错误信息。' }
    }
    & $pythonPath -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] < (3,13) else 1)'
    if ($LASTEXITCODE -ne 0) { throw '项目 .venv 不可用或版本不兼容，需要使用 Python 3.10～3.12 重建。' }

    $requirementsHash = (Get-FileHash -LiteralPath 'backend\requirements.txt' -Algorithm SHA256).Hash
    $stampPath = Join-Path $PSScriptRoot '.venv\requirements.sha256'
    if (-not (Test-Path -LiteralPath $stampPath) -or (Get-Content -LiteralPath $stampPath -Raw).Trim() -ne $requirementsHash) {
        Write-Host '正在安装后端依赖，首次运行需要联网，请稍候…'
        & $pythonPath -m pip install -r (Join-Path $PSScriptRoot 'backend\requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败。请检查网络和上方错误，修复后重新双击启动。' }
        Set-Content -LiteralPath $stampPath -Value $requirementsHash -Encoding ASCII
    }

    if (-not (Test-Path -LiteralPath 'frontend\node_modules\vite\bin\vite.js')) {
        Write-Host '正在安装前端依赖，首次运行需要联网，请稍候…'
        Push-Location -LiteralPath 'frontend'
        try {
            & $npm.Source ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败，请检查网络和上方错误信息。' }
        } finally { Pop-Location }
    }

    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $backendProcess = Start-Process -FilePath $pythonPath -ArgumentList @(
        '-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '5176'
    ) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDirectory 'backend.log') `
        -RedirectStandardError (Join-Path $logDirectory 'backend-error.log')
    Wait-Service 'http://127.0.0.1:5176/openapi.json' $backendProcess '后端'

    $frontendProcess = Start-Process -FilePath $node.Source -ArgumentList @(
        'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort'
    ) -WorkingDirectory (Join-Path $PSScriptRoot 'frontend') -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDirectory 'frontend.log') `
        -RedirectStandardError (Join-Path $logDirectory 'frontend-error.log')
    Wait-Service 'http://127.0.0.1:5175/' $frontendProcess '前端'

    Write-Host '启动成功：http://127.0.0.1:5175/' -ForegroundColor Green
    if (-not $Check) {
        if (-not $NoBrowser) {
            try { Start-Process 'http://127.0.0.1:5175/' }
            catch { Write-Host '无法自动打开浏览器，请手动访问上方地址。' }
        }
        Write-Host '使用期间请保留此窗口。结束使用时，回到此窗口按回车停止前后端。'
        Read-Host '按回车停止' | Out-Null
    }
} catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    # 只结束本次启动的进程及其子进程，不按端口结束其他程序。
    foreach ($serviceProcess in @($frontendProcess, $backendProcess)) {
        if ($serviceProcess -and -not $serviceProcess.HasExited) {
            & taskkill.exe /PID $serviceProcess.Id /T /F | Out-Null
        }
    }
}
exit $exitCode
