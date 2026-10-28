# =====================================================================
#  Kenfeh Coop - agente local (Windows)
#  Recebe teclado/mouse/controle dos amigos (vindos pelo navegador) e
#  "aperta" no seu PC, e detecta qual jogo voce esta rodando.
#  So aceita conexoes do proprio PC (localhost) vindas do site Kenfeh,
#  e so depois de digitar o codigo de pareamento mostrado aqui.
# =====================================================================
param(
  [string]$Origins = "https://kenfeh.shop,https://www.kenfeh.shop,http://localhost:3000",
  [int]$Port = 47821
)

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Kenfeh Coop - agente'
$dataDir = Join-Path $env:LOCALAPPDATA 'Kenfeh'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# ---------- Controle virtual (ViGEm) ----------
# Precisa do driver ViGEmBus instalado: https://github.com/nefarius/ViGEmBus/releases
$vigemDll = Join-Path $dataDir 'Nefarius.ViGEm.Client.dll'
if (-not (Test-Path $vigemDll)) {
  try {
    Write-Host 'Baixando biblioteca do controle virtual (ViGEm)...' -ForegroundColor DarkGray
    $pkg = Join-Path $dataDir 'vigem.zip'
    Invoke-WebRequest -UseBasicParsing 'https://www.nuget.org/api/v2/package/Nefarius.ViGEm.Client/1.21.256' -OutFile $pkg
    $tmp = Join-Path $dataDir 'vigem_pkg'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $pkg -DestinationPath $tmp -Force
    $dll = Get-ChildItem -Recurse -Path (Join-Path $tmp 'lib') -Filter 'Nefarius.ViGEm.Client.dll' |
      Sort-Object { if ($_.DirectoryName -match 'net4') { 0 } elseif ($_.DirectoryName -match 'netstandard2.0') { 1 } else { 2 } } |
      Select-Object -First 1
    if ($dll) { Copy-Item $dll.FullName $vigemDll }
    Remove-Item -Recurse -Force $tmp, $pkg -ErrorAction SilentlyContinue
  } catch {
    Write-Host "Nao consegui baixar a biblioteca do controle: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

$code = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class KenfehAgent
{
    public const string Version = "1.0";

    // ---------------- SendInput ----------------
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion U; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int nIndex);

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_SCANCODE = 0x8;
    const uint MOUSEEVENTF_MOVE = 0x1, MOUSEEVENTF_LEFTDOWN = 0x2, MOUSEEVENTF_LEFTUP = 0x4, MOUSEEVENTF_RIGHTDOWN = 0x8,
        MOUSEEVENTF_RIGHTUP = 0x10, MOUSEEVENTF_MIDDLEDOWN = 0x20, MOUSEEVENTF_MIDDLEUP = 0x40, MOUSEEVENTF_WHEEL = 0x800,
        MOUSEEVENTF_VIRTUALDESK = 0x4000, MOUSEEVENTF_ABSOLUTE = 0x8000;

    static void Send(INPUT inp)
    {
        INPUT[] arr = new INPUT[] { inp };
        SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Key(ushort scan, bool ext, bool up)
    {
        INPUT i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.U.ki.wScan = scan;
        i.U.ki.dwFlags = KEYEVENTF_SCANCODE | (ext ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0);
        Send(i);
    }

    static void Mouse(int dx, int dy, uint flags, uint data)
    {
        INPUT i = new INPUT();
        i.type = INPUT_MOUSE;
        i.U.mi.dx = dx;
        i.U.mi.dy = dy;
        i.U.mi.mouseData = data;
        i.U.mi.dwFlags = flags;
        Send(i);
    }

    // KeyboardEvent.code -> scancode (set 1). Tecla Windows fica de fora de proposito.
    static readonly Dictionary<string, int> Scan = new Dictionary<string, int>();
    static readonly HashSet<string> Ext = new HashSet<string>();
    static void InitKeys()
    {
        string letters = "KeyA:1E KeyB:30 KeyC:2E KeyD:20 KeyE:12 KeyF:21 KeyG:22 KeyH:23 KeyI:17 KeyJ:24 KeyK:25 KeyL:26 KeyM:32 KeyN:31 KeyO:18 KeyP:19 KeyQ:10 KeyR:13 KeyS:1F KeyT:14 KeyU:16 KeyV:2F KeyW:11 KeyX:2D KeyY:15 KeyZ:2C " +
            "Digit1:02 Digit2:03 Digit3:04 Digit4:05 Digit5:06 Digit6:07 Digit7:08 Digit8:09 Digit9:0A Digit0:0B " +
            "Escape:01 Minus:0C Equal:0D Backspace:0E Tab:0F BracketLeft:1A BracketRight:1B Enter:1C ControlLeft:1D Semicolon:27 Quote:28 Backquote:29 " +
            "ShiftLeft:2A Backslash:2B Comma:33 Period:34 Slash:35 ShiftRight:36 NumpadMultiply:37 AltLeft:38 Space:39 CapsLock:3A " +
            "F1:3B F2:3C F3:3D F4:3E F5:3F F6:40 F7:41 F8:42 F9:43 F10:44 NumLock:45 ScrollLock:46 Numpad7:47 Numpad8:48 Numpad9:49 NumpadSubtract:4A " +
            "Numpad4:4B Numpad5:4C Numpad6:4D NumpadAdd:4E Numpad1:4F Numpad2:50 Numpad3:51 Numpad0:52 NumpadDecimal:53 IntlBackslash:56 F11:57 F12:58 IntlRo:73 NumpadComma:7E";
        string ext = "NumpadEnter:1C ControlRight:1D NumpadDivide:35 AltRight:38 Home:47 ArrowUp:48 PageUp:49 ArrowLeft:4B ArrowRight:4D End:4F ArrowDown:50 PageDown:51 Insert:52 Delete:53 ContextMenu:5D";
        foreach (string p in letters.Split(' ')) { string[] kv = p.Split(':'); Scan[kv[0]] = Convert.ToInt32(kv[1], 16); }
        foreach (string p in ext.Split(' ')) { string[] kv = p.Split(':'); Scan[kv[0]] = Convert.ToInt32(kv[1], 16); Ext.Add(kv[0]); }
    }

    static readonly HashSet<string> Down = new HashSet<string>();
    static readonly HashSet<uint> MouseDown = new HashSet<uint>();

    static void KeyCode(string code, bool up)
    {
        int sc;
        if (!Scan.TryGetValue(code, out sc)) return;
        if (up) { if (!Down.Remove(code)) return; } else Down.Add(code);
        Key((ushort)sc, Ext.Contains(code), up);
    }

    static void ReleaseAll()
    {
        foreach (string c in new List<string>(Down)) KeyCode(c, true);
        foreach (uint b in new List<uint>(MouseDown)) Mouse(0, 0, b, 0);
        MouseDown.Clear();
        foreach (int slot in new List<int>(Pads.Keys)) PadState(slot, 0, 0, 0, 0, 0, 0, 0);
    }

    // ---------------- Monitores ----------------
    static System.Drawing.Rectangle[] Monitors;
    static int MonitorIdx = 0;
    static string MonitorsText()
    {
        Monitors = new System.Drawing.Rectangle[System.Windows.Forms.Screen.AllScreens.Length];
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Monitors.Length; i++)
        {
            System.Windows.Forms.Screen s = System.Windows.Forms.Screen.AllScreens[i];
            Monitors[i] = s.Bounds;
            if (i > 0) sb.Append(';');
            sb.Append(i).Append(':').Append(s.Bounds.Width).Append('x').Append(s.Bounds.Height).Append('@').Append(s.Bounds.X).Append(',').Append(s.Bounds.Y).Append(s.Primary ? ":p" : "");
        }
        return sb.ToString();
    }

    static void MoveAbs(double nx, double ny)
    {
        if (Monitors == null || Monitors.Length == 0) MonitorsText();
        System.Drawing.Rectangle m = Monitors[Math.Max(0, Math.Min(Monitors.Length - 1, MonitorIdx))];
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        double px = m.X + Math.Max(0, Math.Min(1, nx)) * (m.Width - 1);
        double py = m.Y + Math.Max(0, Math.Min(1, ny)) * (m.Height - 1);
        int ax = (int)Math.Round((px - vx) * 65535.0 / Math.Max(1, vw - 1));
        int ay = (int)Math.Round((py - vy) * 65535.0 / Math.Max(1, vh - 1));
        Mouse(ax, ay, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0);
    }

    // ---------------- Controle virtual (ViGEm via reflexao) ----------------
    static object VClient;
    static Type TBtn, TAxis, TSlider;
    static readonly Dictionary<int, object> Pads = new Dictionary<int, object>();
    static string VigemError = "";
    static readonly string[] BtnNames = { "A", "B", "X", "Y", "LeftShoulder", "RightShoulder", "", "", "Back", "Start", "LeftThumb", "RightThumb", "Up", "Down", "Left", "Right", "Guide" };

    static object StaticMember(Type t, string name)
    {
        PropertyInfo p = t.GetProperty(name, BindingFlags.Public | BindingFlags.Static);
        if (p != null) return p.GetValue(null, null);
        FieldInfo f = t.GetField(name, BindingFlags.Public | BindingFlags.Static);
        return f != null ? f.GetValue(null) : null;
    }

    static void InitVigem(string dll)
    {
        try
        {
            if (!System.IO.File.Exists(dll)) { VigemError = "biblioteca nao encontrada"; return; }
            Assembly asm = Assembly.LoadFrom(dll);
            Type tClient = asm.GetType("Nefarius.ViGEm.Client.ViGEmClient");
            TBtn = asm.GetType("Nefarius.ViGEm.Client.Targets.Xbox360.Xbox360Button");
            TAxis = asm.GetType("Nefarius.ViGEm.Client.Targets.Xbox360.Xbox360Axis");
            TSlider = asm.GetType("Nefarius.ViGEm.Client.Targets.Xbox360.Xbox360Slider");
            VClient = Activator.CreateInstance(tClient);
        }
        catch (Exception e)
        {
            VClient = null;
            Exception inner = e.InnerException ?? e;
            VigemError = inner.Message;
        }
    }

    static object GetPad(int slot)
    {
        object pad;
        if (Pads.TryGetValue(slot, out pad)) return pad;
        if (VClient == null || Pads.Count >= 4) return null;
        pad = VClient.GetType().GetMethod("CreateXbox360Controller", Type.EmptyTypes).Invoke(VClient, null);
        pad.GetType().GetMethod("Connect").Invoke(pad, null);
        PropertyInfo auto = pad.GetType().GetProperty("AutoSubmitReport");
        if (auto != null && auto.CanWrite) auto.SetValue(pad, false, null);
        Pads[slot] = pad;
        Console.WriteLine("  Controle virtual #" + (slot + 1) + " conectado.");
        return pad;
    }

    static void PadState(int slot, int mask, int lx, int ly, int rx, int ry, int lt, int rt)
    {
        object pad = GetPad(slot);
        if (pad == null) return;
        Type t = pad.GetType();
        MethodInfo setBtn = t.GetMethod("SetButtonState", new Type[] { TBtn, typeof(bool) });
        MethodInfo setAxis = t.GetMethod("SetAxisValue", new Type[] { TAxis, typeof(short) });
        MethodInfo setSlider = t.GetMethod("SetSliderValue", new Type[] { TSlider, typeof(byte) });
        for (int b = 0; b < BtnNames.Length; b++)
        {
            if (BtnNames[b] == "") continue;
            object btn = StaticMember(TBtn, BtnNames[b]);
            if (btn != null) setBtn.Invoke(pad, new object[] { btn, (mask & (1 << b)) != 0 });
        }
        setAxis.Invoke(pad, new object[] { StaticMember(TAxis, "LeftThumbX"), (short)Clamp(lx, -32768, 32767) });
        setAxis.Invoke(pad, new object[] { StaticMember(TAxis, "LeftThumbY"), (short)Clamp(ly, -32768, 32767) });
        setAxis.Invoke(pad, new object[] { StaticMember(TAxis, "RightThumbX"), (short)Clamp(rx, -32768, 32767) });
        setAxis.Invoke(pad, new object[] { StaticMember(TAxis, "RightThumbY"), (short)Clamp(ry, -32768, 32767) });
        setSlider.Invoke(pad, new object[] { StaticMember(TSlider, "LeftTrigger"), (byte)Clamp(lt, 0, 255) });
        setSlider.Invoke(pad, new object[] { StaticMember(TSlider, "RightTrigger"), (byte)Clamp(rt, 0, 255) });
        MethodInfo submit = t.GetMethod("SubmitReport", Type.EmptyTypes);
        if (submit != null) submit.Invoke(pad, null);
    }

    static void PadOff(int slot)
    {
        object pad;
        if (!Pads.TryGetValue(slot, out pad)) return;
        try { pad.GetType().GetMethod("Disconnect").Invoke(pad, null); } catch { }
        Pads.Remove(slot);
    }

    static int Clamp(int v, int a, int b) { return v < a ? a : (v > b ? b : v); }

    // ---------------- Jogo rodando ----------------
    static readonly Dictionary<string, string> GameExe = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    static void InitGames()
    {
        string list = "VALORANT-Win64-Shipping=Valorant|cs2=Counter-Strike 2|League of Legends=League of Legends|FortniteClient-Win64-Shipping=Fortnite|" +
            "r5apex=Apex Legends|r5apex_dx12=Apex Legends|RocketLeague=Rocket League|Minecraft.Windows=Minecraft|GTA5=GTA V|GTA5_Enhanced=GTA V|RDR2=Red Dead Redemption 2|" +
            "eldenring=Elden Ring|Overwatch=Overwatch 2|dota2=Dota 2|Warframe.x64=Warframe|Brawlhalla=Brawlhalla|destiny2=Destiny 2|PathOfExile_x64=Path of Exile|" +
            "PathOfExileSteam=Path of Exile|RobloxPlayerBeta=Roblox|Among Us=Among Us|Terraria=Terraria|Stardew Valley=Stardew Valley|Lethal Company=Lethal Company|" +
            "Phasmophobia=Phasmophobia|Palworld-Win64-Shipping=Palworld|ItTakesTwo=It Takes Two|Overcooked2=Overcooked 2|Cuphead=Cuphead|Marvel-Win64-Shipping=Marvel Rivals|" +
            "RainbowSix=Rainbow Six Siege|cod=Call of Duty|FallGuys_client_game=Fall Guys|hl2=Team Fortress 2|tf_win64=Team Fortress 2|Unturned=Unturned|" +
            "HaloInfinite=Halo Infinite|aces=War Thunder|Stumble Guys=Stumble Guys|DeadByDaylight-Win64-Shipping=Dead by Daylight|bg3=Baldur's Gate 3|bg3_dx11=Baldur's Gate 3|" +
            "Cyberpunk2077=Cyberpunk 2077|SoTGame=Sea of Thieves|FSD-Win64-Shipping=Deep Rock Galactic|left4dead2=Left 4 Dead 2|RustClient=Rust|GenshinImpact=Genshin Impact|" +
            "TslGame=PUBG|helldivers2=Helldivers 2|Hades=Hades|Hades2=Hades II|portal2=Portal 2|TS4_x64=The Sims 4|hollow_knight=Hollow Knight|FC25=EA Sports FC|FC26=EA Sports FC|" +
            "javaw=Minecraft (Java)|retroarch=RetroArch|Dolphin=Dolphin (emulador)|pcsx2-qt=PCSX2 (emulador)|Ryujinx=Ryujinx (emulador)|yuzu=Yuzu (emulador)";
        foreach (string p in list.Split('|')) { string[] kv = p.Split('='); GameExe[kv[0]] = kv[1]; }
    }

    static string DetectGame()
    {
        try
        {
            foreach (Process p in Process.GetProcesses())
            {
                string name;
                if (GameExe.TryGetValue(p.ProcessName, out name)) return name;
            }
        }
        catch { }
        return "-";
    }

    // ---------------- WebSocket local ----------------
    static string PairCode;
    static string[] AllowedOrigins;
    static WebSocket Current;
    static readonly object Lock = new object();

    public static void Run(string pairCode, string origins, string vigemDll, int port)
    {
        PairCode = pairCode;
        AllowedOrigins = origins.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
        InitKeys();
        InitGames();
        InitVigem(vigemDll);
        MonitorsText();

        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://localhost:" + port + "/");
        try { listener.Start(); }
        catch (Exception e)
        {
            Console.WriteLine("ERRO ao abrir a porta " + port + ": " + e.Message);
            Console.WriteLine("Feche outro agente aberto, ou rode este arquivo como Administrador.");
            return;
        }

        Console.WriteLine();
        Console.WriteLine("  ==============================================");
        Console.WriteLine("   Kenfeh Coop rodando!   Codigo de pareamento:");
        Console.WriteLine();
        Console.WriteLine("            >>>   " + PairCode + "   <<<");
        Console.WriteLine();
        Console.WriteLine("  ==============================================");
        Console.WriteLine("  Controle virtual: " + (VClient != null ? "OK (ViGEmBus)" : "indisponivel (" + VigemError + ")"));
        Console.WriteLine("  Monitores: " + MonitorsText());
        Console.WriteLine("  Feche esta janela para desligar.  Ninguem joga sem voce aprovar no site.");
        Console.WriteLine();

        Thread watcher = new Thread(GameWatcher);
        watcher.IsBackground = true;
        watcher.Start();

        while (true)
        {
            HttpListenerContext ctx = listener.GetContext();
            Thread t = new Thread(Handle);
            t.IsBackground = true;
            t.Start(ctx);
        }
    }

    static void GameWatcher()
    {
        string last = null;
        while (true)
        {
            string g = DetectGame();
            if (g != last) { last = g; SendText("game " + g); }
            Thread.Sleep(10000);
            if (Current == null) last = null;
        }
    }

    static void SendText(string text)
    {
        WebSocket ws = Current;
        if (ws == null || ws.State != WebSocketState.Open) return;
        lock (Lock)
        {
            try
            {
                byte[] b = Encoding.UTF8.GetBytes(text);
                ws.SendAsync(new ArraySegment<byte>(b), WebSocketMessageType.Text, true, CancellationToken.None).Wait();
            }
            catch { }
        }
    }

    static void Handle(object o)
    {
        HttpListenerContext ctx = (HttpListenerContext)o;
        try
        {
            string origin = ctx.Request.Headers["Origin"] ?? "";
            bool allowed = Array.IndexOf(AllowedOrigins, origin) >= 0 || Array.IndexOf(AllowedOrigins, "*") >= 0;
            if (!ctx.Request.IsWebSocketRequest || !allowed)
            {
                ctx.Response.StatusCode = allowed ? 200 : 403;
                byte[] msg = Encoding.UTF8.GetBytes(allowed ? "Kenfeh Coop " + Version : "origem nao permitida");
                ctx.Response.OutputStream.Write(msg, 0, msg.Length);
                ctx.Response.Close();
                if (!allowed) Console.WriteLine("  Bloqueado: conexao de " + origin);
                return;
            }
            HttpListenerWebSocketContext wsctx = ctx.AcceptWebSocketAsync(null).Result;
            WebSocket ws = wsctx.WebSocket;
            bool authed = false;
            byte[] buf = new byte[8192];
            while (ws.State == WebSocketState.Open)
            {
                WebSocketReceiveResult r = ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None).Result;
                if (r.MessageType == WebSocketMessageType.Close) break;
                string text = Encoding.UTF8.GetString(buf, 0, r.Count);
                foreach (string line in text.Split('\n'))
                {
                    string[] a = line.Trim().Split(' ');
                    if (a.Length == 0 || a[0] == "") continue;
                    if (!authed)
                    {
                        if (a[0] == "auth" && a.Length > 1 && a[1] == PairCode)
                        {
                            authed = true;
                            lock (Lock)
                            {
                                if (Current != null && Current != ws) { try { Current.Abort(); } catch { } ReleaseAll(); }
                                Current = ws;
                            }
                            Console.WriteLine("  Site conectado (" + origin + ").");
                            SendText("ok " + Version + " " + (VClient != null ? "1" : "0") + " " + MonitorsText());
                            SendText("game " + DetectGame());
                        }
                        else
                        {
                            byte[] e = Encoding.UTF8.GetBytes("err codigo");
                            ws.SendAsync(new ArraySegment<byte>(e), WebSocketMessageType.Text, true, CancellationToken.None).Wait();
                        }
                        continue;
                    }
                    try { Command(a); } catch (Exception ex) { Console.WriteLine("  erro: " + ex.Message); }
                }
            }
        }
        catch { }
        finally
        {
            lock (Lock)
            {
                if (Current != null && Current.State != WebSocketState.Open) { Current = null; ReleaseAll(); Console.WriteLine("  Site desconectado."); }
            }
        }
    }

    static int I(string s) { int v; int.TryParse(s, out v); return v; }
    static double D(string s) { double v; double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v); return v; }

    static void Command(string[] a)
    {
        switch (a[0])
        {
            case "kd": KeyCode(a[1], false); break;
            case "ku": KeyCode(a[1], true); break;
            case "mm": Mouse(Clamp(I(a[1]), -2000, 2000), Clamp(I(a[2]), -2000, 2000), MOUSEEVENTF_MOVE, 0); break;
            case "ma": MoveAbs(D(a[1]), D(a[2])); break;
            case "md":
            case "mu":
                {
                    bool up = a[0] == "mu";
                    int b = I(a[1]);
                    uint f = b == 2 ? (up ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_RIGHTDOWN) : b == 1 ? (up ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_MIDDLEDOWN) : (up ? MOUSEEVENTF_LEFTUP : MOUSEEVENTF_LEFTDOWN);
                    uint pair = b == 2 ? MOUSEEVENTF_RIGHTUP : b == 1 ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_LEFTUP;
                    if (up) MouseDown.Remove(pair); else MouseDown.Add(pair);
                    Mouse(0, 0, f, 0);
                    break;
                }
            case "mw": Mouse(0, 0, MOUSEEVENTF_WHEEL, unchecked((uint)Clamp(I(a[1]), -1200, 1200))); break;
            case "pad": PadState(I(a[1]), I(a[2]), I(a[3]), I(a[4]), I(a[5]), I(a[6]), I(a[7]), I(a[8])); break;
            case "padoff": PadOff(I(a[1])); break;
            case "mon": MonitorIdx = I(a[1]); break;
            case "rel": ReleaseAll(); break;
            case "ping": SendText("pong " + a[1]); break;
        }
    }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Windows.Forms, System.Drawing -Language CSharp

$pair = -join ((1..6) | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 })
Write-Host ''
Write-Host '  Kenfeh Coop - agente local' -ForegroundColor Cyan
Write-Host '  Dica: se o jogo roda como Administrador, rode este agente como Administrador tambem.' -ForegroundColor DarkGray
[KenfehAgent]::Run($pair, $Origins, $vigemDll, $Port)
