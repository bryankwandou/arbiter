@echo off
rem Carry Hyperliquid: rencana, konfirmasi, buka posisi, lalu jaga posisi.
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo File .env dibuat. Isi HL_ACCOUNT dan HL_AGENT_KEY, simpan, tutup Notepad, lalu jalankan file ini lagi.
  notepad .env
  exit /b
)
if not exist node_modules call npm ci --ignore-scripts --no-audit --no-fund
node carry-hl.js plan || (pause & exit /b 1)
echo.
node carry-hl.js open || (pause & exit /b 1)
echo.
set OK=
set /p OK=Ketik YA untuk membuka posisi sungguhan:
if /I not "%OK%"=="YA" (
  echo Dibatalkan. Tidak ada order yang dikirim.
  pause
  exit /b
)
node carry-hl.js open --live || (pause & exit /b 1)
echo.
echo Posisi dibuka. Penjaga likuidasi berjalan selama jendela ini terbuka.
node carry-hl.js watch --live
pause
