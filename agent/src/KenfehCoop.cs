// =====================================================================
//  Kenfeh Coop — app do Windows para o Modo Jogo Coop
//  Quem transmite continua jogando normalmente (Jogador 1). Cada amigo
//  ganha um controle virtual próprio (Jogador 2, 3, 4), então o jogo
//  enxerga pessoas diferentes. Modo extra: compartilhar teclado/mouse.
//  Só aceita conexões do próprio PC, vindas do site, com o código.
//  Compilar: scripts/build-agent.sh  (C# 5, .NET Framework 4.x)
// =====================================================================
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Kenfeh Coop")]
[assembly: AssemblyProduct("Kenfeh Coop")]
[assembly: AssemblyDescription("Modo Jogo Coop do Kenfeh: amigos jogam no seu PC como jogadores separados")]
[assembly: AssemblyVersion("2.0.0.0")]

namespace KenfehCoop
{
    static class Program
    {
        static Mutex single;

        [STAThread]
        static void Main(string[] args)
        {
            bool console = Array.IndexOf(args, "--console") >= 0;
            // qualquer erro aparece na tela e vai para %LOCALAPPDATA%\Kenfeh\erro.txt (antes fechava sem avisar)
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Crash(e.ExceptionObject as Exception, console);
            if (!console)
            {
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
                Application.ThreadException += (s, e) => Crash(e.Exception, false);
            }
            try { Start(args, console); }
            catch (Exception e) { Crash(e, console); }
        }

        static void Crash(Exception e, bool console)
        {
            string text = "Kenfeh Coop " + Agent.Version + " — " + DateTime.Now + "\r\n" + Environment.OSVersion + " / .NET " + Environment.Version + "\r\n\r\n" + e;
            string file = Path.Combine(Path.GetTempPath(), "KenfehCoop-erro.txt");
            try
            {
                Directory.CreateDirectory(Agent.DataDir);
                file = Path.Combine(Agent.DataDir, "erro.txt");
            }
            catch { }
            try { File.WriteAllText(file, text); } catch { }
            if (console) { Console.WriteLine(text); return; }
            try
            {
                MessageBox.Show("O Kenfeh Coop encontrou um erro e não conseguiu abrir:\n\n" + (e == null ? "?" : e.GetType().Name + ": " + e.Message) +
                    "\n\nOs detalhes foram salvos em:\n" + file + "\n\nMande esse arquivo para quem cuida do Kenfeh.", "Kenfeh Coop — erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch { }
        }

        static void Start(string[] args, bool console)
        {
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { } // TLS 1.2
            if (!console)
            {
                // só uma cópia aberta (a segunda só avisa)
                bool first;
                single = new Mutex(true, "KenfehCoop-unico", out first);
                if (!first)
                {
                    MessageBox.Show("O Kenfeh Coop já está aberto — procure o ícone dele na barra de tarefas.", "Kenfeh Coop", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
            }
            string extra = "";
            foreach (string a in args) if (a.StartsWith("http")) extra += a + ",";
            Agent.Init(extra);
            if (console)
            {
                // modo sem janela (testes / quem preferir terminal)
                Agent.LogToConsole = true;
                Console.WriteLine("Kenfeh Coop " + Agent.Version + " — código de pareamento: " + Agent.PairCode);
                Agent.Run();
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Thread t = new Thread(Agent.Run);
            t.IsBackground = true;
            t.Start();
            Application.Run(new MainForm());
            Agent.ReleaseAll();
        }
    }

    class Slot
    {
        public string Name;
        public DateTime LastInput = DateTime.MinValue;
        public bool PadConnected;
    }

    static class Agent
    {
        public const string Version = "2.0";
        public const int Port = 47821;
        public static string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Kenfeh");

        // estado lido pela interface
        public static string PairCode;
        public static bool SiteConnected;
        public static string SiteOrigin = "";
        public static string Game = "-";
        public static string ListenError = "";
        public static DateTime SharedInput = DateTime.MinValue;
        public static readonly Slot[] Slots = { new Slot(), new Slot(), new Slot(), new Slot() };
        public static readonly List<string> Log = new List<string>();
        static string[] AllowedOrigins;

        public static void Init(string extraOrigins)
        {
            Directory.CreateDirectory(DataDir);
            string codeFile = Path.Combine(DataDir, "pair.txt");
            PairCode = File.Exists(codeFile) ? File.ReadAllText(codeFile).Trim() : "";
            if (PairCode.Length != 6) NewCode();
            List<string> o = new List<string> { "https://kenfeh.shop", "https://www.kenfeh.shop", "http://localhost:3000" };
            foreach (string s in extraOrigins.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries)) o.Add(s.Trim());
            string originsFile = Path.Combine(DataDir, "origins.txt");
            if (File.Exists(originsFile)) foreach (string s in File.ReadAllLines(originsFile)) if (s.Trim() != "") o.Add(s.Trim());
            AllowedOrigins = o.ToArray();
            InitKeys();
            try { InitGames(); } catch (Exception e) { AddLog("Detector de jogo desligado: " + e.Message); }
            try { InitVigem(); } catch (Exception e) { VigemError = e.Message; }
        }

        public static void NewCode()
        {
            Random r = new Random();
            PairCode = r.Next(100000, 1000000).ToString();
            try { File.WriteAllText(Path.Combine(DataDir, "pair.txt"), PairCode); } catch { }
            WebSocket ws = Current;
            if (ws != null) { try { ws.Abort(); } catch { } }
        }

        public static bool LogToConsole;
        public static void AddLog(string s)
        {
            if (LogToConsole) Console.WriteLine(s);
            lock (Log)
            {
                Log.Add(DateTime.Now.ToString("HH:mm:ss") + "  " + s);
                if (Log.Count > 60) Log.RemoveAt(0);
            }
        }

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

        const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_SCANCODE = 0x8;
        const uint M_MOVE = 0x1, M_LDOWN = 0x2, M_LUP = 0x4, M_RDOWN = 0x8, M_RUP = 0x10, M_MDOWN = 0x20, M_MUP = 0x40, M_WHEEL = 0x800, M_VDESK = 0x4000, M_ABS = 0x8000;

        static void Send(INPUT inp) { SendInput(1, new INPUT[] { inp }, Marshal.SizeOf(typeof(INPUT))); }

        static void Key(ushort scan, bool ext, bool up)
        {
            INPUT i = new INPUT();
            i.type = 1;
            i.U.ki.wScan = scan;
            i.U.ki.dwFlags = KEYEVENTF_SCANCODE | (ext ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0);
            Send(i);
        }

        static void Mouse(int dx, int dy, uint flags, uint data)
        {
            INPUT i = new INPUT();
            i.type = 0;
            i.U.mi.dx = dx;
            i.U.mi.dy = dy;
            i.U.mi.mouseData = data;
            i.U.mi.dwFlags = flags;
            Send(i);
        }

        static readonly Dictionary<string, int> Scan = new Dictionary<string, int>();
        static readonly HashSet<string> Ext = new HashSet<string>();
        static void InitKeys()
        {
            string normal = "KeyA:1E KeyB:30 KeyC:2E KeyD:20 KeyE:12 KeyF:21 KeyG:22 KeyH:23 KeyI:17 KeyJ:24 KeyK:25 KeyL:26 KeyM:32 KeyN:31 KeyO:18 KeyP:19 KeyQ:10 KeyR:13 KeyS:1F KeyT:14 KeyU:16 KeyV:2F KeyW:11 KeyX:2D KeyY:15 KeyZ:2C " +
                "Digit1:02 Digit2:03 Digit3:04 Digit4:05 Digit5:06 Digit6:07 Digit7:08 Digit8:09 Digit9:0A Digit0:0B " +
                "Escape:01 Minus:0C Equal:0D Backspace:0E Tab:0F BracketLeft:1A BracketRight:1B Enter:1C ControlLeft:1D Semicolon:27 Quote:28 Backquote:29 " +
                "ShiftLeft:2A Backslash:2B Comma:33 Period:34 Slash:35 ShiftRight:36 NumpadMultiply:37 AltLeft:38 Space:39 CapsLock:3A " +
                "F1:3B F2:3C F3:3D F4:3E F5:3F F6:40 F7:41 F8:42 F9:43 F10:44 NumLock:45 ScrollLock:46 Numpad7:47 Numpad8:48 Numpad9:49 NumpadSubtract:4A " +
                "Numpad4:4B Numpad5:4C Numpad6:4D NumpadAdd:4E Numpad1:4F Numpad2:50 Numpad3:51 Numpad0:52 NumpadDecimal:53 IntlBackslash:56 F11:57 F12:58 IntlRo:73 NumpadComma:7E";
            string ext = "NumpadEnter:1C ControlRight:1D NumpadDivide:35 AltRight:38 Home:47 ArrowUp:48 PageUp:49 ArrowLeft:4B ArrowRight:4D End:4F ArrowDown:50 PageDown:51 Insert:52 Delete:53 ContextMenu:5D";
            foreach (string p in normal.Split(' ')) { string[] kv = p.Split(':'); Scan[kv[0]] = Convert.ToInt32(kv[1], 16); }
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

        public static void ReleaseAll()
        {
            lock (Down)
            {
                foreach (string c in new List<string>(Down)) KeyCode(c, true);
                foreach (uint b in new List<uint>(MouseDown)) Mouse(0, 0, b, 0);
                MouseDown.Clear();
            }
            foreach (int slot in new List<int>(Pads.Keys)) { try { PadState(slot, 0, 0, 0, 0, 0, 0, 0); } catch { } }
        }

        static Rectangle[] Monitors;
        static int MonitorIdx = 0;
        static string MonitorsText()
        {
            Screen[] all;
            try { all = Screen.AllScreens; } catch { Monitors = new Rectangle[] { new Rectangle(0, 0, 1920, 1080) }; return "0:1920x1080@0,0:p"; }
            Monitors = new Rectangle[all.Length];
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < all.Length; i++)
            {
                Monitors[i] = all[i].Bounds;
                if (i > 0) sb.Append(';');
                sb.Append(i).Append(':').Append(all[i].Bounds.Width).Append('x').Append(all[i].Bounds.Height).Append('@').Append(all[i].Bounds.X).Append(',').Append(all[i].Bounds.Y).Append(all[i].Primary ? ":p" : "");
            }
            return sb.ToString();
        }

        static void MoveAbs(double nx, double ny)
        {
            if (Monitors == null || Monitors.Length == 0) MonitorsText();
            Rectangle m = Monitors[Math.Max(0, Math.Min(Monitors.Length - 1, MonitorIdx))];
            int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
            double px = m.X + Math.Max(0, Math.Min(1, nx)) * (m.Width - 1);
            double py = m.Y + Math.Max(0, Math.Min(1, ny)) * (m.Height - 1);
            Mouse((int)Math.Round((px - vx) * 65535.0 / Math.Max(1, vw - 1)), (int)Math.Round((py - vy) * 65535.0 / Math.Max(1, vh - 1)), M_MOVE | M_ABS | M_VDESK, 0);
        }

        // ---------------- Controles virtuais (ViGEm) ----------------
        public static object VClient;
        static Type TBtn, TAxis, TSlider;
        static readonly Dictionary<int, object> Pads = new Dictionary<int, object>();
        public static string VigemError = "";
        public static bool BusMissing { get { return VClient == null && VigemError.Contains("ViGEmBus"); } }
        public static bool VigemDllMissing;
        static readonly string[] BtnNames = { "A", "B", "X", "Y", "LeftShoulder", "RightShoulder", "", "", "Back", "Start", "LeftThumb", "RightThumb", "Up", "Down", "Left", "Right", "Guide" };
        // versão para .NET Framework 4.5+ (a "netstandard" não abria em alguns Windows)
        static string VigemDll { get { return Path.Combine(DataDir, "Nefarius.ViGEm.Client-net45.dll"); } }

        static object StaticMember(Type t, string name)
        {
            PropertyInfo p = t.GetProperty(name, BindingFlags.Public | BindingFlags.Static);
            if (p != null) return p.GetValue(null, null);
            FieldInfo f = t.GetField(name, BindingFlags.Public | BindingFlags.Static);
            return f != null ? f.GetValue(null) : null;
        }

        public static void InitVigem()
        {
            try
            {
                if (!File.Exists(VigemDll)) DownloadVigemDll();
                if (!File.Exists(VigemDll)) { VigemDllMissing = true; VigemError = "biblioteca não baixada"; return; }
                VigemDllMissing = false;
                Assembly asm = Assembly.LoadFrom(VigemDll);
                TBtn = asm.GetType("Nefarius.ViGEm.Client.Targets.Xbox360.Xbox360Button");
                TAxis = asm.GetType("Nefarius.ViGEm.Client.Targets.Xbox360.Xbox360Axis");
                TSlider = asm.GetType("Nefarius.ViGEm.Client.Targets.Xbox360.Xbox360Slider");
                VClient = Activator.CreateInstance(asm.GetType("Nefarius.ViGEm.Client.ViGEmClient"));
                VigemError = "";
            }
            catch (Exception e)
            {
                VClient = null;
                Exception inner = e.InnerException ?? e;
                VigemError = inner.GetType().Name.Contains("BusNotFound") ? "componente ViGEmBus ainda não instalado" : inner.Message;
            }
        }

        // os componentes vêm dentro do próprio .exe (nada para baixar)
        static bool ExtractResource(string name, string dest)
        {
            try
            {
                using (Stream rs = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
                {
                    if (rs == null) return false;
                    using (FileStream fs = File.Create(dest)) rs.CopyTo(fs);
                }
                return true;
            }
            catch (Exception e) { AddLog("Falha ao preparar componente: " + e.Message); return false; }
        }

        static void DownloadVigemDll()
        {
            if (ExtractResource("ViGEmClient.dll", VigemDll)) return;
            try
            {
                AddLog("Baixando a biblioteca do controle virtual…");
                string pkg = Path.Combine(DataDir, "vigem.zip");
                using (WebClient wc = new WebClient()) wc.DownloadFile("https://www.nuget.org/api/v2/package/Nefarius.ViGEm.Client/1.17.178", pkg);
                using (System.IO.Compression.ZipArchive z = System.IO.Compression.ZipFile.OpenRead(pkg))
                {
                    System.IO.Compression.ZipArchiveEntry best = null;
                    int bestRank = 99;
                    foreach (System.IO.Compression.ZipArchiveEntry e in z.Entries)
                    {
                        if (!e.FullName.EndsWith("Nefarius.ViGEm.Client.dll", StringComparison.OrdinalIgnoreCase) || !e.FullName.StartsWith("lib/")) continue;
                        int rank = e.FullName.Contains("net4") ? 0 : e.FullName.Contains("netstandard2.0") ? 1 : 2;
                        if (rank < bestRank) { best = e; bestRank = rank; }
                    }
                    if (best != null) System.IO.Compression.ZipFileExtensions.ExtractToFile(best, VigemDll, true);
                }
                File.Delete(pkg);
            }
            catch (Exception e) { AddLog("Falha ao baixar biblioteca: " + e.Message); }
        }

        // instala o driver oficial (assinado) do ViGEmBus com um clique
        public static void InstallDriver()
        {
            try
            {
                string exe = Path.Combine(Path.GetTempPath(), "KenfehCoop_ControleVirtual_Setup.exe");
                if (!ExtractResource("ViGEmBusSetup.exe", exe))
                {
                    AddLog("Baixando o componente de controle virtual…");
                    using (WebClient wc = new WebClient()) wc.DownloadFile("https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe", exe);
                }
                AddLog("Instalando o componente de controle virtual…");
                ProcessStartInfo psi = new ProcessStartInfo(exe);
                psi.UseShellExecute = true;
                psi.Verb = "runas";
                Process p = Process.Start(psi);
                p.WaitForExit();
                AddLog("Instalação terminou. Testando o controle virtual…");
                InitVigem();
            }
            catch (Exception e)
            {
                AddLog("Não deu para instalar automaticamente: " + e.Message);
                try { Process.Start("https://github.com/nefarius/ViGEmBus/releases/latest"); } catch { }
            }
        }

        static object GetPad(int slot)
        {
            object pad;
            if (Pads.TryGetValue(slot, out pad)) return pad;
            if (VClient == null || slot < 0 || slot > 3) return null;
            pad = VClient.GetType().GetMethod("CreateXbox360Controller", Type.EmptyTypes).Invoke(VClient, null);
            pad.GetType().GetMethod("Connect").Invoke(pad, null);
            PropertyInfo auto = pad.GetType().GetProperty("AutoSubmitReport");
            if (auto != null && auto.CanWrite) auto.SetValue(pad, false, null);
            Pads[slot] = pad;
            Slots[slot].PadConnected = true;
            AddLog("Controle virtual do Jogador " + (slot + 2) + " conectado.");
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
            if (slot >= 0 && slot < 4) { Slots[slot].PadConnected = false; Slots[slot].Name = null; }
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
                "RainbowSix=Rainbow Six Siege|cod=Call of Duty|FallGuys_client_game=Fall Guys|tf_win64=Team Fortress 2|Unturned=Unturned|" +
                "HaloInfinite=Halo Infinite|aces=War Thunder|Stumble Guys=Stumble Guys|DeadByDaylight-Win64-Shipping=Dead by Daylight|bg3=Baldur's Gate 3|bg3_dx11=Baldur's Gate 3|" +
                "Cyberpunk2077=Cyberpunk 2077|SoTGame=Sea of Thieves|FSD-Win64-Shipping=Deep Rock Galactic|left4dead2=Left 4 Dead 2|RustClient=Rust|GenshinImpact=Genshin Impact|" +
                "TslGame=PUBG|helldivers2=Helldivers 2|Hades=Hades|Hades2=Hades II|portal2=Portal 2|TS4_x64=The Sims 4|hollow_knight=Hollow Knight|FC25=EA Sports FC|FC26=EA Sports FC|" +
                "SplitFiction=Split Fiction|Brothers=Brothers: A Tale of Two Sons|UNRAVEL2=Unravel Two|PicoPark=Pico Park|Moving Out=Moving Out|Castle Crashers=Castle Crashers|" +
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

        // ---------------- Conexão local com o site ----------------
        static WebSocket Current;
        static readonly object SendLock = new object();

        public static void Run()
        {
            MonitorsText();
            HttpListener listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:" + Port + "/");
            try { listener.Start(); }
            catch (Exception e)
            {
                ListenError = "Não consegui abrir a porta " + Port + " (" + e.Message + "). Feche outra cópia do Kenfeh Coop.";
                AddLog(ListenError);
                return;
            }
            AddLog("Pronto. Esperando o site conectar…");
            Thread watcher = new Thread(GameWatcher);
            watcher.IsBackground = true;
            watcher.Start();
            while (true)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); } catch { continue; }
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
                Game = DetectGame();
                if (Game != last) { last = Game; SendText("game " + Game); }
                Thread.Sleep(8000);
                if (Current == null) last = null;
            }
        }

        static void SendText(string text)
        {
            WebSocket ws = Current;
            if (ws == null || ws.State != WebSocketState.Open) return;
            lock (SendLock)
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
            WebSocket ws = null;
            try
            {
                string origin = ctx.Request.Headers["Origin"] ?? "";
                bool allowed = Array.IndexOf(AllowedOrigins, origin) >= 0;
                if (!ctx.Request.IsWebSocketRequest || !allowed)
                {
                    ctx.Response.StatusCode = allowed || origin == "" ? 200 : 403;
                    byte[] msg = Encoding.UTF8.GetBytes(allowed || origin == "" ? "Kenfeh Coop " + Version : "origem nao permitida");
                    ctx.Response.OutputStream.Write(msg, 0, msg.Length);
                    ctx.Response.Close();
                    if (!allowed && origin != "") AddLog("Bloqueado: " + origin);
                    return;
                }
                ws = ctx.AcceptWebSocketAsync(null).Result.WebSocket;
                bool authed = false;
                byte[] buf = new byte[16384];
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
                                if (Current != null && Current != ws) { try { Current.Abort(); } catch { } ReleaseAll(); }
                                Current = ws;
                                SiteConnected = true;
                                SiteOrigin = origin;
                                AddLog("Site conectado (" + origin + ").");
                                SendText("ok " + Version + " " + (VClient != null ? "1" : "0") + " " + MonitorsText());
                                SendText("game " + DetectGame());
                            }
                            else
                            {
                                byte[] e = Encoding.UTF8.GetBytes("err codigo");
                                ws.SendAsync(new ArraySegment<byte>(e), WebSocketMessageType.Text, true, CancellationToken.None).Wait();
                                AddLog("Tentativa com código errado.");
                            }
                            continue;
                        }
                        try { Command(a); } catch (Exception ex) { AddLog("erro: " + ex.Message); }
                    }
                }
            }
            catch { }
            finally
            {
                if (ws != null && Current == ws)
                {
                    Current = null;
                    SiteConnected = false;
                    ReleaseAll();
                    for (int i = 0; i < 4; i++) PadOff(i);
                    AddLog("Site desconectado.");
                }
            }
        }

        static int I(string s) { int v; int.TryParse(s, out v); return v; }
        static double D(string s) { double v; double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v); return v; }

        static void Command(string[] a)
        {
            switch (a[0])
            {
                case "kd": lock (Down) KeyCode(a[1], false); SharedInput = DateTime.Now; break;
                case "ku": lock (Down) KeyCode(a[1], true); break;
                case "mm": Mouse(Clamp(I(a[1]), -2000, 2000), Clamp(I(a[2]), -2000, 2000), M_MOVE, 0); SharedInput = DateTime.Now; break;
                case "ma": MoveAbs(D(a[1]), D(a[2])); SharedInput = DateTime.Now; break;
                case "md":
                case "mu":
                    {
                        bool up = a[0] == "mu";
                        int b = I(a[1]);
                        uint f = b == 2 ? (up ? M_RUP : M_RDOWN) : b == 1 ? (up ? M_MUP : M_MDOWN) : (up ? M_LUP : M_LDOWN);
                        uint pair = b == 2 ? M_RUP : b == 1 ? M_MUP : M_LUP;
                        lock (Down) { if (up) MouseDown.Remove(pair); else MouseDown.Add(pair); }
                        Mouse(0, 0, f, 0);
                        break;
                    }
                case "mw": Mouse(0, 0, M_WHEEL, unchecked((uint)Clamp(I(a[1]), -1200, 1200))); break;
                case "pad":
                    {
                        int slot = I(a[1]);
                        PadState(slot, I(a[2]), I(a[3]), I(a[4]), I(a[5]), I(a[6]), I(a[7]), I(a[8]));
                        if (slot >= 0 && slot < 4) Slots[slot].LastInput = DateTime.Now;
                        break;
                    }
                case "padoff": PadOff(I(a[1])); break;
                case "label":
                    {
                        int slot = I(a[1]);
                        if (slot >= 0 && slot < 4) { Slots[slot].Name = string.Join(" ", a, 2, a.Length - 2); AddLog(Slots[slot].Name + " entrou como Jogador " + (slot + 2) + "."); }
                        break;
                    }
                case "mon": MonitorIdx = I(a[1]); break;
                case "rel": ReleaseAll(); break;
                case "ping": SendText("pong " + a[1]); break;
            }
        }

        // dono tirou alguém pelo app: desliga o controle e avisa o site (que corta o acesso do convidado)
        public static void Kick(int slot)
        {
            if (slot < 0 || slot > 3) return;
            string name = Slots[slot].Name ?? "Jogador " + (slot + 2);
            PadOff(slot);
            Slots[slot].Name = null;
            SendText("kick " + slot);
            AddLog(name + " foi tirado do jogo.");
        }

        public static void StopAll()
        {
            ReleaseAll();
            for (int i = 0; i < 4; i++) PadOff(i);
            SendText("stop");
            AddLog("Tudo parado pelo app.");
        }
    }

    // =====================================================================
    //  Interface
    // =====================================================================
    // Painel com cantos arredondados (os cards da janela)
    class RoundPanel : Panel
    {
        public Color Fill;
        public Color Border = Color.Empty;
        public int Radius = 14;
        public RoundPanel() { DoubleBuffered = true; SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true); }
        public static GraphicsPath Path(Rectangle r, int rad)
        {
            GraphicsPath p = new GraphicsPath();
            int d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent != null ? (Parent is RoundPanel ? ((RoundPanel)Parent).Fill : Parent.BackColor) : BackColor);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath gp = Path(r, Radius))
            {
                using (SolidBrush b = new SolidBrush(Fill)) e.Graphics.FillPath(b, gp);
                if (Border != Color.Empty) using (Pen pen = new Pen(Border)) e.Graphics.DrawPath(pen, gp);
            }
        }
    }

    class MainForm : Form
    {
        static readonly Color Bg = Color.FromArgb(9, 11, 20);
        static readonly Color Card = Color.FromArgb(19, 24, 42);
        static readonly Color Card2 = Color.FromArgb(28, 34, 58);
        static readonly Color Line = Color.FromArgb(40, 48, 78);
        static readonly Color Text1 = Color.FromArgb(238, 241, 251);
        static readonly Color Text2 = Color.FromArgb(150, 158, 186);
        static readonly Color Blue = Color.FromArgb(61, 139, 255);
        static readonly Color Pink = Color.FromArgb(255, 61, 154);
        static readonly Color Green = Color.FromArgb(61, 220, 151);
        static readonly Color Yellow = Color.FromArgb(255, 204, 77);
        static readonly Color Red = Color.FromArgb(255, 77, 109);
        static readonly Color[] PlayerColors = { Blue, Pink, Green, Yellow, Color.FromArgb(160, 120, 255) };

        // logo do Kenfeh (PNG embutido, nítido em qualquer escala)
        static Image Mark = LoadMark();
        static Image LoadMark()
        {
            try { using (Stream st = Assembly.GetExecutingAssembly().GetManifestResourceStream("kenfeh-mark.png")) return st == null ? null : new Bitmap(st); }
            catch { return null; }
        }

        Label codeLbl, siteDot, siteLbl, padDot, padLbl, gameLbl, logLbl;
        Label[] pName = new Label[5], pStatus = new Label[5];
        Button[] pKick = new Button[5];
        Button installBtn;
        System.Windows.Forms.Timer timer;

        public MainForm()
        {
            Text = "Kenfeh Coop";
            ClientSize = new Size(500, 738);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Bg;
            ForeColor = Text1;
            Font = new Font("Segoe UI", 10f);
            StartPosition = FormStartPosition.CenterScreen;
            DoubleBuffered = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // ---------- topo ----------
            Panel header = new Panel { Location = new Point(0, 0), Size = new Size(500, 92) };
            header.Paint += (s, e) =>
            {
                Graphics g = e.Graphics;
                using (LinearGradientBrush br = new LinearGradientBrush(header.ClientRectangle, Color.FromArgb(255, 61, 154), Color.FromArgb(61, 123, 255), 0f)) g.FillRectangle(br, header.ClientRectangle);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                if (Mark != null) g.DrawImage(Mark, new Rectangle(22, 20, 52, 52));
                else using (Font f = new Font("Segoe UI Emoji", 22f)) g.DrawString("🎮", f, Brushes.White, 26, 25);
                using (Font f = new Font("Segoe UI", 19f, FontStyle.Bold)) g.DrawString("Kenfeh Coop", f, Brushes.White, 86, 16);
                using (Font f = new Font("Segoe UI", 9.5f)) g.DrawString("Seus amigos jogam no seu PC como jogadores separados", f, Brushes.White, 89, 52);
                using (Font f = new Font("Segoe UI", 8f, FontStyle.Bold)) g.DrawString("v" + Agent.Version, f, Brushes.White, 452, 8);
            };
            Controls.Add(header);

            // ---------- 1. conectar ----------
            RoundPanel c1 = Section(16, 106, 468, 150, "1", "CONECTAR AO SITE");
            c1.Controls.Add(MakeLabel("No Kenfeh: call → 🕹️ Modo Jogo Coop → digite este código", 46, 34, 410, Text2, 8.5f, FontStyle.Regular));
            codeLbl = MakeLabel("", 16, 58, 240, Text1, 30f, FontStyle.Bold);
            codeLbl.Height = 56;
            c1.Controls.Add(codeLbl);
            Button copy = MakeButton("Copiar", 262, 68, 92, Pink);
            copy.Click += (s, e) => { try { Clipboard.SetText(Agent.PairCode); copy.Text = "Copiado ✓"; } catch { } };
            c1.Controls.Add(copy);
            Button renew = MakeButton("Novo código", 360, 68, 92, Card2);
            renew.Click += (s, e) => Agent.NewCode();
            c1.Controls.Add(renew);
            siteDot = MakeLabel("●", 16, 118, 18, Yellow, 10f, FontStyle.Regular);
            siteLbl = MakeLabel("", 34, 118, 420, Text1, 9.5f, FontStyle.Regular);
            c1.Controls.Add(siteDot);
            c1.Controls.Add(siteLbl);
            Controls.Add(c1);

            // ---------- 2. seu PC ----------
            RoundPanel c2 = Section(16, 268, 468, 112, "2", "SEU PC");
            padDot = MakeLabel("●", 16, 38, 18, Red, 10f, FontStyle.Regular);
            padLbl = MakeLabel("", 34, 38, 270, Text1, 9.5f, FontStyle.Regular);
            installBtn = MakeButton("Ativar controles", 318, 32, 134, Pink);
            installBtn.Click += (s, e) =>
            {
                installBtn.Enabled = false;
                installBtn.Text = "Ativando…";
                Thread t = new Thread(() => { Agent.InstallDriver(); BeginInvoke(new Action(() => { installBtn.Enabled = true; installBtn.Text = "Ativar controles"; })); });
                t.IsBackground = true;
                t.Start();
            };
            gameLbl = MakeLabel("", 16, 72, 436, Text2, 9.5f, FontStyle.Regular);
            c2.Controls.Add(padDot);
            c2.Controls.Add(padLbl);
            c2.Controls.Add(installBtn);
            c2.Controls.Add(gameLbl);
            Controls.Add(c2);

            // ---------- 3. jogadores ----------
            RoundPanel c3 = Section(16, 392, 468, 254, "3", "JOGADORES");
            for (int i = 0; i < 5; i++)
            {
                int idx = i;
                RoundPanel row = new RoundPanel { Fill = Card2, Radius = 10, Location = new Point(12, 34 + i * 43), Size = new Size(444, 37) };
                Color pc = PlayerColors[i];
                Panel badge = new Panel { Location = new Point(8, 6), Size = new Size(25, 25), BackColor = Color.Transparent };
                badge.Paint += (s, e) =>
                {
                    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    using (SolidBrush b = new SolidBrush(pc)) e.Graphics.FillEllipse(b, 0, 0, 24, 24);
                    e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                    using (Font f = new Font("Segoe UI", 8.5f, FontStyle.Bold)) { SizeF sz = e.Graphics.MeasureString("J" + (idx + 1), f); e.Graphics.DrawString("J" + (idx + 1), f, Brushes.White, 12 - sz.Width / 2, 12 - sz.Height / 2); }
                };
                row.Controls.Add(badge);
                pName[i] = MakeLabel("", 42, 9, 196, Text1, 9.5f, FontStyle.Bold);
                pStatus[i] = MakeLabel("", 240, 10, i == 0 ? 196 : 120, Text2, 8.5f, FontStyle.Regular);
                row.Controls.Add(pName[i]);
                row.Controls.Add(pStatus[i]);
                if (i > 0)
                {
                    Button kick = MakeButton("Expulsar", 364, 5, 72, Color.FromArgb(70, 255, 77, 109));
                    kick.Height = 27;
                    kick.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
                    kick.Click += (s, e) =>
                    {
                        string n = Agent.Slots[idx - 1].Name ?? "esse jogador";
                        if (MessageBox.Show(this, "Tirar " + n + " do seu jogo? O controle dele é desligado na hora.", "Expulsar jogador", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes) Agent.Kick(idx - 1);
                    };
                    pKick[i] = kick;
                    row.Controls.Add(kick);
                }
                c3.Controls.Add(row);
            }
            Controls.Add(c3);

            // ---------- rodapé ----------
            logLbl = MakeLabel("", 20, 654, 460, Text2, 8.5f, FontStyle.Regular);
            logLbl.Height = 34;
            Controls.Add(logLbl);
            Button stop = MakeButton("🛑  Parar tudo agora", 16, 690, 230, Red);
            stop.Click += (s, e) => Agent.StopAll();
            Controls.Add(stop);
            Button site = MakeButton("Abrir o Kenfeh", 254, 690, 230, Card2);
            site.Click += (s, e) => { try { Process.Start("https://kenfeh.shop"); } catch { } };
            Controls.Add(site);

            Shown += (s, e) =>
            {
                if (!Agent.BusMissing) return;
                DialogResult r = MessageBox.Show(this,
                    "Para seus amigos jogarem como jogadores separados (Jogador 2, 3, 4 e 5), o Kenfeh Coop precisa ativar o controle virtual no seu PC.\n\n" +
                    "Isso é feito uma única vez e já vem dentro deste app — nada para baixar. O Windows vai pedir permissão de administrador.\n\nAtivar agora?",
                    "Kenfeh Coop — ativar controles", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (r == DialogResult.Yes) installBtn.PerformClick();
            };

            timer = new System.Windows.Forms.Timer { Interval = 300 };
            timer.Tick += (s, e) => Refresh2();
            timer.Start();
            Refresh2();
        }

        RoundPanel Section(int x, int y, int w, int h, string step, string title)
        {
            RoundPanel p = new RoundPanel { Fill = Card, Border = Line, Location = new Point(x, y), Size = new Size(w, h) };
            Panel num = new Panel { Location = new Point(14, 10), Size = new Size(22, 22), BackColor = Color.Transparent };
            num.Paint += (s, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (LinearGradientBrush b = new LinearGradientBrush(new Rectangle(0, 0, 22, 22), Blue, Pink, 45f)) e.Graphics.FillEllipse(b, 0, 0, 21, 21);
                e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                using (Font f = new Font("Segoe UI", 8.5f, FontStyle.Bold)) { SizeF sz = e.Graphics.MeasureString(step, f); e.Graphics.DrawString(step, f, Brushes.White, 11 - sz.Width / 2, 11 - sz.Height / 2); }
            };
            p.Controls.Add(num);
            p.Controls.Add(MakeLabel(title, 44, 12, 300, Text2, 8.5f, FontStyle.Bold));
            return p;
        }

        static void SetText(Label l, string t, Color c) { if (l.Text != t) l.Text = t; if (l.ForeColor != c) l.ForeColor = c; }

        void Refresh2()
        {
            SetText(codeLbl, Agent.PairCode.Substring(0, 3) + " " + Agent.PairCode.Substring(3), Text1);
            if (Agent.ListenError != "") { SetText(siteDot, "●", Red); SetText(siteLbl, Agent.ListenError, Red); }
            else if (Agent.SiteConnected) { SetText(siteDot, "●", Green); SetText(siteLbl, "Conectado ao site (" + Agent.SiteOrigin.Replace("https://", "") + ")", Green); }
            else { SetText(siteDot, "●", Yellow); SetText(siteLbl, "Esperando o site… abra o Modo Jogo Coop e digite o código", Yellow); }
            bool padOk = Agent.VClient != null;
            SetText(padDot, "●", padOk ? Green : Red);
            SetText(padLbl, padOk ? "Controles virtuais prontos (até 4 amigos)" : "Controle virtual: " + Agent.VigemError, padOk ? Text1 : Red);
            installBtn.Visible = !padOk;
            SetText(gameLbl, "🎯  Jogo detectado:  " + (Agent.Game == "-" ? "nenhum (abra o jogo)" : Agent.Game), Agent.Game == "-" ? Text2 : Text1);
            bool sharedActive = (DateTime.Now - Agent.SharedInput).TotalSeconds < 2;
            SetText(pName[0], "Você (dono do PC)", Text1);
            SetText(pStatus[0], sharedActive ? "amigo no seu teclado" : "joga normal (seu teclado/controle)", sharedActive ? Yellow : Text2);
            for (int i = 0; i < 4; i++)
            {
                Slot s = Agent.Slots[i];
                bool used = s.Name != null || s.PadConnected;
                bool active = (DateTime.Now - s.LastInput).TotalSeconds < 1.5;
                SetText(pName[i + 1], used ? (s.Name ?? "Amigo") : "Livre", used ? Text1 : Text2);
                SetText(pStatus[i + 1], used ? (active ? "● jogando" : "conectado, parado") : "vaga livre", used ? (active ? Green : Text2) : Text2);
                pKick[i + 1].Visible = used;
            }
            lock (Agent.Log)
            {
                int n = Agent.Log.Count;
                string t = string.Join("\n", Agent.Log.GetRange(Math.Max(0, n - 2), Math.Min(2, n)).ToArray());
                if (logLbl.Text != t) logLbl.Text = t;
            }
        }

        static Panel MakeCard(int x, int y, int w, int h)
        {
            Panel p = new Panel { Location = new Point(x, y), Size = new Size(w, h), BackColor = Card };
            return p;
        }

        static Label MakeLabel(string text, int x, int y, int w, Color c, float size, FontStyle style)
        {
            return new Label { Text = text, Location = new Point(x, y), Size = new Size(w, (int)(size * 2.2f) + 4), ForeColor = c, BackColor = Color.Transparent, Font = new Font("Segoe UI", size, style), AutoEllipsis = true };
        }

        static Button MakeButton(string text, int x, int y, int w, Color bg)
        {
            Button b = new Button { Text = text, Location = new Point(x, y), Size = new Size(w, 36), BackColor = bg, ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), Cursor = Cursors.Hand };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }
    }
}
