#!/bin/sh
# Compila o app Kenfeh Coop (Windows) usando o compilador C# do Mono.
# Resultado: agent/dist/KenfehCoop.exe (roda no .NET Framework 4.x que já vem no Windows 10/11)
set -e
cd "$(dirname "$0")/.."
mcs -target:winexe -langversion:5 -optimize+ \
  -r:System.Windows.Forms -r:System.Drawing -r:System.IO.Compression -r:System.IO.Compression.FileSystem \
  -win32icon:agent/src/kenfeh.ico \
  -resource:agent/vendor/Nefarius.ViGEm.Client.dll,ViGEmClient.dll -resource:agent/vendor/ViGEmBus_Setup.exe,ViGEmBusSetup.exe -out:agent/dist/KenfehCoop.exe agent/src/KenfehCoop.cs
echo "OK: agent/dist/KenfehCoop.exe"
