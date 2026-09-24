//go:build windows

package main

// Opened by the Foundry Dock, the app gets --dock=<the dock's window>. Its
// window is then created off screen and turned into a child of the dock
// (no title bar, no taskbar button) before it is ever shown; the dock puts
// it in its frame. Without the flag nothing changes.

import (
	"os"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wsChild            = 0x40000000
	wsPopup            = 0x80000000
	wsMinimize         = 0x20000000
	wsMaximize         = 0x01000000
	wsOverlappedWindow = 0x00CF0000
	wsClipSiblings     = 0x04000000
	wsClipChildren     = 0x02000000
	wsExAppWindow      = 0x00040000
	wsExNoParentNotify = 0x00000004
	whCBT              = 5
	hcbtCreateWnd      = 3
)

var (
	procSetWindowsHookEx = user32.NewProc("SetWindowsHookExW")
	procUnhookWinHookEx  = user32.NewProc("UnhookWindowsHookEx")
	procCallNextHookEx   = user32.NewProc("CallNextHookEx")
	procIsWindow         = user32.NewProc("IsWindow")
	procGetWindowLongPtr = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtr = user32.NewProc("SetWindowLongPtrW")
	procSetParent        = user32.NewProc("SetParent")
	procShowWindow       = user32.NewProc("ShowWindow")
	procSetWindowPos     = user32.NewProc("SetWindowPos")
	procGetCurrentThread = kernel32.NewProc("GetCurrentThreadId")

	mainHwnd   uintptr // this app's window, once created
	offscreen  bool
	cbtHookFun = windows.NewCallback(cbtHook)
)

// dockParentArg is the dock's window from --dock=, if it still exists.
func dockParentArg() uintptr {
	for _, a := range os.Args[1:] {
		v, ok := strings.CutPrefix(a, "--dock=")
		if !ok {
			continue
		}
		h, err := strconv.ParseUint(v, 10, 64)
		if err != nil || h == 0 {
			continue
		}
		if r, _, _ := procIsWindow.Call(uintptr(h)); r != 0 {
			return uintptr(h)
		}
	}
	return 0
}

type createStruct struct {
	CreateParams, Instance, Menu, Parent uintptr
	Cy, Cx, Y, X                         int32
	Style                                uint32
	Name, Class                          uintptr
	ExStyle                              uint32
}

// cbtHook moves the first window this thread creates off screen, so it
// isn't seen before it moves into the dock.
func cbtHook(code, wp, lp uintptr) uintptr {
	if code == hcbtCreateWnd && !offscreen {
		var cbt struct{ cs, insertAfter uintptr }
		procMoveMemory.Call(uintptr(unsafe.Pointer(&cbt)), lp, unsafe.Sizeof(cbt))
		var cs createStruct
		procMoveMemory.Call(uintptr(unsafe.Pointer(&cs)), cbt.cs, unsafe.Sizeof(cs))
		if cs.Parent == 0 {
			offscreen = true
			cs.X, cs.Y = -32000, -32000
			procMoveMemory.Call(cbt.cs, uintptr(unsafe.Pointer(&cs)), unsafe.Sizeof(cs))
		}
	}
	r, _, _ := procCallNextHookEx.Call(0, code, wp, lp)
	return r
}

// hookOffscreen must run on the thread that creates the window.
func hookOffscreen() (unhook func()) {
	tid, _, _ := procGetCurrentThread.Call()
	h, _, _ := procSetWindowsHookEx.Call(whCBT, cbtHookFun, 0, tid)
	return func() {
		if h != 0 {
			procUnhookWinHookEx.Call(h)
		}
	}
}

// enterDock makes the window a hidden child of the dock; the dock shows it
// once it knows where it goes.
func enterDock(h, parent uintptr) {
	gwlStyle, gwlExStyle := -16, -20
	procShowWindow.Call(h, 0) // SW_HIDE
	style, _, _ := procGetWindowLongPtr.Call(h, uintptr(gwlStyle))
	style = style&^(wsOverlappedWindow|wsPopup|wsMinimize|wsMaximize) | wsChild | wsClipSiblings | wsClipChildren
	procSetWindowLongPtr.Call(h, uintptr(gwlStyle), style)
	ex, _, _ := procGetWindowLongPtr.Call(h, uintptr(gwlExStyle))
	procSetWindowLongPtr.Call(h, uintptr(gwlExStyle), ex&^wsExAppWindow|wsExNoParentNotify)
	procSetParent.Call(h, parent)
	procSetWindowPos.Call(h, 0, 0, 0, 0, 0, 0x0001|0x0002|0x0004|0x0010|0x0020) // NOSIZE|NOMOVE|NOZORDER|NOACTIVATE|FRAMECHANGED
}

// isDocked says whether the window is inside the dock right now (the dock
// can also give it back as a normal window).
func isDocked() bool {
	if mainHwnd == 0 {
		return false
	}
	gwlStyle := -16
	style, _, _ := procGetWindowLongPtr.Call(mainHwnd, uintptr(gwlStyle))
	return style&wsChild != 0
}
