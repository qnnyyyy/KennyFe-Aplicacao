#!/bin/sh
# Compila o app Kenfeh Coop (Windows) usando o compilador C# do Mono.
# Compila contra as definições oficiais do .NET Framework 4.5 (baixadas do NuGet na primeira vez),
# para nunca usar uma função que só existe no Mono e não no Windows.
# Resultado: agent/dist/KenfehCoop.exe (roda no .NET Framework 4.5+ que já vem no Windows 10/11)
set -e
cd "$(dirname "$0")/.."
REF=agent/.refs/build/.NETFramework/v4.5
if [ ! -f "$REF/mscorlib.dll" ]; then
  mkdir -p agent/.refs
  curl -sL -o agent/.refs/ref.nupkg https://api.nuget.org/v3-flatcontainer/microsoft.netframework.referenceassemblies.net45/1.0.3/microsoft.netframework.referenceassemblies.net45.1.0.3.nupkg
  (cd agent/.refs && unzip -o -q ref.nupkg && rm ref.nupkg)
fi
mcs -target:winexe -langversion:5 -optimize+ -nostdlib -noconfig \
  -r:$REF/mscorlib.dll -r:$REF/System.dll -r:$REF/System.Core.dll -r:$REF/System.Windows.Forms.dll -r:$REF/System.Drawing.dll \
  -r:$REF/System.IO.Compression.dll -r:$REF/System.IO.Compression.FileSystem.dll \
  -win32icon:agent/src/kenfeh.ico \
  -resource:agent/src/kenfeh-mark.png,kenfeh-mark.png -resource:agent/vendor/Nefarius.ViGEm.Client.dll,ViGEmClient.dll -resource:agent/vendor/ViGEmBus_Setup.exe,ViGEmBusSetup.exe -out:agent/dist/KenfehCoop.exe agent/src/KenfehCoop.cs
echo "OK: agent/dist/KenfehCoop.exe"
