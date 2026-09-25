package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const appName = "FoundryListener"

// oldAppName is where versions from before the rename kept their config.
const oldAppName = "Ouvidor"

type Config struct {
	Token          string `json:"token"`
	GuildID        string `json:"guildId"`
	GMID           string `json:"gmId"`
	VoiceChannelID string `json:"voiceChannelId"`
	WSPort         int    `json:"wsPort"`
	FoundryPort    int    `json:"foundryPort"`
	AutoStart      bool   `json:"autoStart"`

	// Gravação
	RecordDir     string   `json:"recordDir"`
	RecordExclude []string `json:"recordExclude"` // IDs do Discord que não são gravados
	RecordNotify  bool     `json:"recordNotify"`  // avisa no chat do canal de voz
}

func dataDir() string {
	base, err := os.UserCacheDir() // %LocalAppData% no Windows
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, appName)
}

func configPath() string {
	base, err := os.UserConfigDir() // %AppData% no Windows
	if err != nil {
		base = dataDir()
	}
	return filepath.Join(base, appName, "config.json")
}

func defaultConfig() Config {
	return Config{WSPort: 8770, FoundryPort: 30000, AutoStart: true, RecordNotify: true}
}

func (c *Config) normalize() {
	c.Token = strings.TrimSpace(c.Token)
	c.GuildID = strings.TrimSpace(c.GuildID)
	c.GMID = strings.TrimSpace(c.GMID)
	c.VoiceChannelID = strings.TrimSpace(c.VoiceChannelID)
	if c.WSPort < 1 || c.WSPort > 65535 {
		c.WSPort = 8770
	}
	if c.FoundryPort < 1 || c.FoundryPort > 65535 {
		c.FoundryPort = 30000
	}
	c.RecordDir = strings.TrimSpace(c.RecordDir)
	if c.RecordDir == "" {
		c.RecordDir = defaultRecordDir()
	}
	c.RecordExclude, _ = parseIDList(strings.Join(c.RecordExclude, ","))
	if c.RecordExclude == nil {
		c.RecordExclude = []string{}
	}
}

var snowflake = regexp.MustCompile(`^\d{17,20}$`)

// Validate returns what is missing or wrong, in the words the UI shows.
func (c Config) Validate() error {
	var problems []string
	if c.Token == "" {
		problems = append(problems, "o token do bot")
	}
	if !snowflake.MatchString(c.GuildID) {
		problems = append(problems, "o ID do servidor")
	}
	if !snowflake.MatchString(c.GMID) {
		problems = append(problems, "o seu ID do Discord (GM)")
	}
	if c.VoiceChannelID != "" && !snowflake.MatchString(c.VoiceChannelID) {
		problems = append(problems, "o ID do canal de voz (ou deixe vazio)")
	}
	if len(problems) == 0 {
		return nil
	}
	return errors.New("Preencha na engrenagem: " + strings.Join(problems, ", ") + ".")
}

func loadConfig() Config {
	cfg := defaultConfig()
	if b, err := os.ReadFile(configPath()); err == nil {
		_ = json.Unmarshal(b, &cfg)
	} else if b, err := os.ReadFile(filepath.Join(filepath.Dir(filepath.Dir(configPath())), oldAppName, "config.json")); err == nil {
		// Configuração do tempo em que o app se chamava Ouvidor.
		_ = json.Unmarshal(b, &cfg)
	} else if dir, err := locateBot(); err == nil {
		// Primeira vez: aproveita o .env de quem já usava o iniciar.bat.
		importEnv(filepath.Join(dir, ".env"), &cfg)
	}
	cfg.normalize()
	return cfg
}

func saveConfig(cfg Config) error {
	p := configPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(p, b, 0o600)
}

func parseEnv(r *bufio.Scanner) map[string]string {
	out := map[string]string{}
	for r.Scan() {
		line := strings.TrimSpace(r.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		}
		out[strings.TrimSpace(strings.TrimPrefix(k, "export "))] = v
	}
	return out
}

func importEnv(path string, cfg *Config) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	env := parseEnv(bufio.NewScanner(f))
	cfg.Token = env["DISCORD_TOKEN"]
	cfg.GuildID = env["GUILD_ID"]
	cfg.GMID = env["GM_DISCORD_ID"]
	cfg.VoiceChannelID = env["VOICE_CHANNEL_ID"]
	fmt.Sscan(env["WS_PORT"], &cfg.WSPort)
}

// App liga a interface ao gerenciador do bot.
type App struct {
	mu  sync.Mutex
	cfg Config
	mgr *Manager
}

func NewApp() *App {
	cfg := loadConfig()
	return &App{cfg: cfg, mgr: NewManager(cfg)}
}

// uiConfig is the config as the UI sees it: the token never goes back.
type uiConfig struct {
	HasToken       bool   `json:"hasToken"`
	GuildID        string `json:"guildId"`
	GMID           string `json:"gmId"`
	VoiceChannelID string `json:"voiceChannelId"`
	WSPort         int    `json:"wsPort"`
	FoundryPort    int    `json:"foundryPort"`
	AutoStart      bool   `json:"autoStart"`
	RecordDir      string `json:"recordDir"`
	RecordExclude  string `json:"recordExclude"`
	RecordNotify   bool   `json:"recordNotify"`
}

type uiState struct {
	State
	Config uiConfig `json:"config"`
	Docked bool     `json:"docked"` // inside the Foundry Dock
}

type configInput struct {
	Token          *string `json:"token"`
	GuildID        string  `json:"guildId"`
	GMID           string  `json:"gmId"`
	VoiceChannelID string  `json:"voiceChannelId"`
	WSPort         int     `json:"wsPort"`
	FoundryPort    int     `json:"foundryPort"`
	AutoStart      bool    `json:"autoStart"`
}

type recordConfigInput struct {
	Dir     string `json:"dir"`
	Exclude string `json:"exclude"`
	Notify  bool   `json:"notify"`
}

// Call runs one UI action. arg is a plain string (may be empty or JSON).
func (a *App) Call(name, arg string) (any, error) {
	switch name {
	case "state":
		a.mu.Lock()
		c := a.cfg
		a.mu.Unlock()
		return uiState{State: a.mgr.Snapshot(), Config: uiConfig{
			HasToken: c.Token != "", GuildID: c.GuildID, GMID: c.GMID, VoiceChannelID: c.VoiceChannelID,
			WSPort: c.WSPort, FoundryPort: c.FoundryPort, AutoStart: c.AutoStart,
			RecordDir: c.RecordDir, RecordExclude: strings.Join(c.RecordExclude, ", "), RecordNotify: c.RecordNotify,
		}, Docked: isDocked()}, nil
	case "start":
		a.mgr.Start()
	case "stop":
		a.mgr.Stop()
	case "restart":
		a.mgr.Restart()
	case "join":
		return nil, a.mgr.Send(map[string]string{"cmd": "join", "channelId": strings.TrimSpace(arg)})
	case "leave":
		return nil, a.mgr.Send(map[string]string{"cmd": "leave"})
	case "recordStart":
		c := a.config()
		if err := os.MkdirAll(c.RecordDir, 0o755); err != nil {
			return nil, fmt.Errorf("não consegui criar a pasta das gravações: %w", err)
		}
		return nil, a.mgr.Send(map[string]any{
			"cmd": "record-start", "dir": c.RecordDir, "exclude": c.RecordExclude, "notify": c.RecordNotify,
		})
	case "recordStop":
		return nil, a.mgr.Send(map[string]string{"cmd": "record-stop"})
	case "recordMark":
		return nil, a.mgr.Send(map[string]string{"cmd": "record-mark", "label": strings.TrimSpace(arg)})
	case "recordMix":
		dir, err := recordingDir(a.config().RecordDir, arg)
		if err != nil {
			return nil, err
		}
		return nil, a.mgr.Send(map[string]string{"cmd": "record-mix", "dir": dir})
	case "recordings":
		return listRecordings(a.config().RecordDir, 5), nil
	case "openRecordings":
		dir := a.config().RecordDir
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
		return nil, openURL(dir)
	case "openRecording":
		dir, err := recordingDir(a.config().RecordDir, arg)
		if err != nil {
			return nil, err
		}
		return nil, openURL(dir)
	case "saveRecordConfig":
		var in recordConfigInput
		if err := json.Unmarshal([]byte(arg), &in); err != nil {
			return nil, errors.New("configuração inválida")
		}
		dir := strings.TrimSpace(in.Dir)
		if dir != "" && !filepath.IsAbs(dir) {
			return nil, errors.New("a pasta precisa ser um caminho completo, como D:\\Gravações")
		}
		ids, bad := parseIDList(in.Exclude)
		if len(bad) > 0 {
			return nil, fmt.Errorf("isto não parece um ID do Discord: %s", strings.Join(bad, ", "))
		}
		a.mu.Lock()
		c := a.cfg
		c.RecordDir, c.RecordExclude, c.RecordNotify = dir, ids, in.Notify
		c.normalize()
		a.cfg = c
		a.mu.Unlock()
		if err := saveConfig(c); err != nil {
			return nil, err
		}
		a.mgr.SetConfig(c)
		return nil, nil
	case "copy":
		return nil, copyToClipboard(arg)
	case "open":
		if !strings.HasPrefix(arg, "https://") {
			return nil, errors.New("link inválido")
		}
		return nil, openURL(arg)
	case "openBotFolder":
		dir, err := locateBot()
		if err != nil {
			return nil, err
		}
		return nil, openURL(dir)
	case "saveConfig":
		var in configInput
		if err := json.Unmarshal([]byte(arg), &in); err != nil {
			return nil, errors.New("configuração inválida")
		}
		a.mu.Lock()
		c := a.cfg
		if in.Token != nil && strings.TrimSpace(*in.Token) != "" {
			c.Token = *in.Token
		}
		c.GuildID, c.GMID, c.VoiceChannelID = in.GuildID, in.GMID, in.VoiceChannelID
		c.WSPort, c.FoundryPort, c.AutoStart = in.WSPort, in.FoundryPort, in.AutoStart
		c.normalize()
		changed := c.Token != a.cfg.Token || c.GuildID != a.cfg.GuildID || c.GMID != a.cfg.GMID ||
			c.VoiceChannelID != a.cfg.VoiceChannelID || c.WSPort != a.cfg.WSPort
		a.cfg = c
		a.mu.Unlock()
		if err := saveConfig(c); err != nil {
			return nil, err
		}
		a.mgr.SetConfig(c)
		if changed && a.mgr.Running() {
			a.mgr.Restart()
		}
		return nil, nil
	default:
		return nil, fmt.Errorf("ação desconhecida: %s", name)
	}
	return nil, nil
}

func (a *App) config() Config {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg
}

func (a *App) AutoStart() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg.AutoStart && a.cfg.Validate() == nil
}
