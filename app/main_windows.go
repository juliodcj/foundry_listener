//go:build windows

package main

import (
	_ "embed"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

//go:embed ui/index.html
var indexHTML string

const createNoWindow = 0x08000000

var (
	user32           = windows.NewLazySystemDLL("user32.dll")
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	procOpenClip     = user32.NewProc("OpenClipboard")
	procCloseClip    = user32.NewProc("CloseClipboard")
	procEmptyClip    = user32.NewProc("EmptyClipboard")
	procSetClipData  = user32.NewProc("SetClipboardData")
	procGlobalAlloc  = kernel32.NewProc("GlobalAlloc")
	procGlobalLock   = kernel32.NewProc("GlobalLock")
	procGlobalUnlock = kernel32.NewProc("GlobalUnlock")
	procGlobalFree   = kernel32.NewProc("GlobalFree")
	procMoveMemory   = kernel32.NewProc("RtlMoveMemory")
	procDpiForSystem = user32.NewProc("GetDpiForSystem")
	procSysParamInfo = user32.NewProc("SystemParametersInfoW")

	jobHandle windows.Handle
)

func messageBox(text string) {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString("Foundry Listener")
	windows.MessageBox(0, t, c, windows.MB_ICONINFORMATION)
}

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// A job object with KILL_ON_JOB_CLOSE makes Windows end the bot if this
// app exits in any way, crashes included.
func initJob() {
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(h, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(h)
		return
	}
	jobHandle = h
}

func attachToJob(cmd *exec.Cmd) {
	if jobHandle == 0 || cmd.Process == nil {
		return
	}
	ph, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return
	}
	_ = windows.AssignProcessToJobObject(jobHandle, ph)
	windows.CloseHandle(ph)
}

func copyToClipboard(text string) error {
	u, err := windows.UTF16FromString(text)
	if err != nil {
		return err
	}
	var opened bool
	for i := 0; i < 10; i++ {
		if r, _, _ := procOpenClip.Call(0); r != 0 {
			opened = true
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if !opened {
		return syscall.Errno(windows.ERROR_ACCESS_DENIED)
	}
	defer procCloseClip.Call()
	procEmptyClip.Call()
	size := uintptr(len(u) * 2)
	h, _, err := procGlobalAlloc.Call(0x0002, size) // GMEM_MOVEABLE
	if h == 0 {
		return err
	}
	p, _, err := procGlobalLock.Call(h)
	if p == 0 {
		procGlobalFree.Call(h)
		return err
	}
	procMoveMemory.Call(p, uintptr(unsafe.Pointer(&u[0])), size)
	procGlobalUnlock.Call(h)
	if r, _, err := procSetClipData.Call(13, h); r == 0 { // CF_UNICODETEXT
		procGlobalFree.Call(h)
		return err
	}
	return nil
}

func openURL(url string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	target, _ := windows.UTF16PtrFromString(url)
	return windows.ShellExecute(0, verb, target, nil, nil, windows.SW_SHOWNORMAL)
}

// windowSize scales a size in 96-DPI pixels to the display's DPI and keeps
// the height inside the screen's work area (the part above the taskbar).
func windowSize(w, h int) (int, int) {
	dpi := 96
	if procDpiForSystem.Find() == nil {
		if r, _, _ := procDpiForSystem.Call(); r != 0 {
			dpi = int(r)
		}
	}
	w, h = w*dpi/96, h*dpi/96
	var work struct{ Left, Top, Right, Bottom int32 }
	if r, _, _ := procSysParamInfo.Call(0x0030, 0, uintptr(unsafe.Pointer(&work)), 0); r != 0 { // SPI_GETWORKAREA
		if maxH := int(work.Bottom-work.Top) - 16; maxH > 0 && h > maxH {
			h = maxH
		}
	}
	return w, h
}

func main() {
	name, _ := windows.UTF16PtrFromString("Local\\FoundryListenerSingleInstance")
	if _, err := windows.CreateMutex(nil, false, name); err == windows.ERROR_ALREADY_EXISTS {
		messageBox("O Foundry Listener já está aberto.")
		return
	}

	initJob()
	app := NewApp()
	width, height := windowSize(470, 860)
	minW, minH := windowSize(420, 600)

	// Opened by the Foundry Dock: start off screen, then move inside it.
	dockParent := dockParentArg()
	unhook := func() {}
	if dockParent != 0 {
		unhook = hookOffscreen()
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  filepath.Join(dataDir(), "webview"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "Foundry Listener · Retratos Falantes",
			Width:  uint(width),
			Height: uint(height),
			IconId: 1,
			Center: true,
		},
	})
	unhook()
	if w == nil {
		messageBox("Não foi possível abrir a janela: o Microsoft Edge WebView2 Runtime não foi encontrado.\n\n" +
			"Instale-o em https://developer.microsoft.com/microsoft-edge/webview2/ e abra o Foundry Listener de novo.")
		os.Exit(1)
	}
	defer w.Destroy()
	mainHwnd = uintptr(w.Window())
	w.SetSize(minW, minH, webview2.HintMin)
	if dockParent != 0 {
		enterDock(mainHwnd, dockParent)
	}
	_ = w.Bind("appCall", func(name, arg string) (any, error) {
		return app.Call(name, arg)
	})
	w.SetHtml(indexHTML)
	if app.AutoStart() {
		app.mgr.Start()
	}
	w.Run()
	app.mgr.Stop()
}
