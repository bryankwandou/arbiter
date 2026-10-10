@echo off
rem Carry Hyperliquid: rencana, konfirmasi, buka posisi, lalu jaga posisi.
rem   start-carry.bat           mainnet (uang asli), kunci di .env
rem   start-carry.bat testnet   testnet (USDC mainan), kunci di .env.testnet
cd /d "%~dp0"
set FLAG=
set ENVF=.env
if /I "%1"=="testnet" (
  set FLAG=--testnet
  set ENVF=.env.testnet
  echo == TESTNET: USDC mainan, harga tidak nyata, hanya menguji mekanik ==
)
if not exist %ENVF% (
  copy .env.example %ENVF% >nul
  echo File %ENVF% dibuat. Isi HL_ACCOUNT dan HL_AGENT_KEY, simpan, tutup Notepad, lalu jalankan file ini lagi.
  notepad %ENVF%
  exit /b
)
if not exist node_modules call npm ci --ignore-scripts --no-audit --no-fund
node carry-hl.js plan %FLAG% || (pause & exit /b 1)
echo.
node carry-hl.js open %FLAG% || (pause & exit /b 1)
echo.
set OK=
set /p OK=Ketik YA untuk membuka posisi:
if /I not "%OK%"=="YA" (
  echo Dibatalkan. Tidak ada order yang dikirim.
  pause
  exit /b
)
node carry-hl.js open %FLAG% --live || (pause & exit /b 1)
echo.
echo Posisi dibuka. Penjaga likuidasi berjalan selama jendela ini terbuka.
node carry-hl.js watch %FLAG% --live
pause
