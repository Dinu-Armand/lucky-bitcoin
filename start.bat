@echo off
rem Lucky Bitcoin - ALL IN ONE: un singur click porneste aplicatia completa (backend + pagina web) pe http://localhost:4000
setlocal
cd /d "%~dp0"
title Lucky Bitcoin

if not exist "backend\.env" (
  if exist "backend\.env.example" (
    copy "backend\.env.example" "backend\.env" >nul
    echo [!] Am creat backend\.env din .env.example.
    echo     Daca parola PostgreSQL nu este "postgres", editeaza DATABASE_URL, salveaza si inchide Notepad.
    notepad "backend\.env"
  )
)

if not exist "backend\node_modules" (
  echo Instalez dependintele backend...
  pushd backend
  call npm install
  popd
)
if not exist "frontend\node_modules" (
  echo Instalez dependintele frontend...
  pushd frontend
  call npm install
  popd
)

echo Construiesc interfata web...
pushd frontend
call npm run build
if errorlevel 1 (
  popd
  echo.
  echo [EROARE] Construirea interfetei a esuat. Vezi mesajul de mai sus.
  pause
  exit /b 1
)
popd

rem Deschide browserul automat cand serverul raspunde (ruleaza in fundal)
start "" /min cmd /c "for /l %%i in (1,1,120) do (curl -s -o nul http://localhost:4000/api/health && (start http://localhost:4000 & exit) || timeout /t 1 /nobreak >nul)"

echo.
echo Pornesc Lucky Bitcoin pe http://localhost:4000  (inchide aceasta fereastra pentru a opri aplicatia)
echo.
cd backend
call npm start
echo.
echo Serverul s-a oprit. Daca ai vazut o eroare mai sus, trimite-o.
pause
