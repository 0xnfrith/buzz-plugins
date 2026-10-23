#!/bin/bash
# plugin.sh update|toggle|install-probe: drive Settings -> Manage plugins in the real app, the way a hand would.
#   update         Vim mode: reinstall from the folder it was loaded from (the work tree) ("Update" in the details panel);
#                  does nothing when the installed code already equals the work tree's
#   toggle         Vim mode: the details panel's main button when it says Disable or Enable (it says Update after a change on disk)
#   install-probe  load plugins/key-probe/ (Add -> Browse -> the GTK folder chooser -> Install plugin)
# Clicks at fixed places: the app's window at 0,0 and 1200x800, the plugin list not scrolled, no dialog open, Buzz 1.0 on
# Linux. If the layout differs, move the numbers in the click lines. Afterwards run check.sh to see what is installed.
. "$(dirname "$0")/lib.sh"
click() { xdotool mousemove "$1" "$2" click 1; sleep "${3:-1.5}"; }
open_plugins() {
  focus_app
  xdotool key --delay 150 Escape; sleep 0.5
  click 1052 28            # the profile menu
  click 853 241 2.5        # Plugins
}
close_settings() { click 1127 105 1.5; xdotool mousemove "$PARK_X" "$PARK_Y"; }
vim_row() {
  click 964 546 0.8        # the search box
  xdotool key ctrl+a; xdotool type --delay 60 "vim"; sleep 2
  click 520 666 2          # the Vim mode row -> its details panel
}
case "$1" in
  update)
    # When nothing changed on disk the same button says Disable: do not click it.
    if "$HERE/check.sh" | grep -q '^megatech.vim-mode: .* MATCHES'; then echo "Vim mode is already the work tree's"; exit 0; fi
    open_plugins; vim_row
    click 978 370 3.5      # Update (details panel)
    click 718 552 6        # Update (confirm dialog)
    close_settings ;;
  toggle)
    open_plugins; vim_row
    click 979 370 3        # Disable / Enable
    close_settings ;;
  install-probe)
    open_plugins
    click 1045 186 2       # Add
    click 390 438 3        # Browse: the GTK folder chooser opens as a window of its own
    # No window manager here: give the chooser the keyboard (the newest window with its title), then type the path.
    chooser=$(xdotool search --name 'Choose a plugin folder' | tail -1)
    xdotool mousemove 59 59 click 1; sleep 1.5          # Home (Enter in the location box does nothing from Recent)
    xdotool windowfocus "$chooser"; sleep 0.5
    xdotool key ctrl+l; sleep 1
    xdotool type --delay 30 "$(cd "$HERE/../../../key-probe" && pwd)/"; sleep 1.5
    xdotool key Return; sleep 3                         # into the folder: the host's "Review plugin access" opens
    click 939 416 4                                     # Install plugin (Enable plugin is already on)
    close_settings ;;
  *) echo "usage: plugin.sh update|toggle|install-probe" >&2; exit 1 ;;
esac
