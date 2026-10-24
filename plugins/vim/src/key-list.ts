// The key list: the same rows feed the Vim mode page and the help dialog. The third column, where there is one, says how
// the key reaches the app (see NOTES.md).
import { apple } from "./constants";
import { leaderSpec } from "./leader";
import type { KeyGroup } from "./types";

export const groups = (): KeyGroup[] => {
  const L = leaderSpec().show ?? leaderSpec().label;
  return [
    {
      title: "NORMAL, messages and panes",
      intro: `One normal mode. A pane is one column: its messages, then its message box at the bottom. The label says NORMAL and the pane that has the keys (main, side for a thread, sidebar for the channel list). This part is for the focus in a list: the message list, the channel list or a thread.`,
      rows: [
        ["j  k", "Next / previous message (message list) or channel (channel list). j past the newest message goes down into the pane's message box, in NORMAL", "DOM"],
        ["5j", "Counts: 0-9, then a motion", "API"],
        ["gg  G", "First / latest message or channel", "API + DOM"],
        ["Ctrl-d  Ctrl-u", "Scroll half a page (Control on a Mac too, not Command)", "DOM"],
        ["Ctrl-e  Ctrl-y", "Scroll one line down / up and leave the cursor where it is (5 Ctrl-e: five lines). The cursor moves only when it would leave the view, onto the nearest row still in it. Scrolls the pane that has the keys: the message list, the thread pane, the channel list, a page such as Reminders, Agents or Workflows, the Settings dialog. Control on a Mac too", "DOM"],
        ["h  l", "Move focus between the channel list, the message list and the thread pane. l on a channel opens it", "DOM"],
        [`${L}  then  h  l  q  <  >  |  =`, "The leader key, for pane commands that work from anywhere, the message box too: h and l move to the pane on the left or right (from a message box, to the box of the pane beside it, or to the channel list), q closes the thread, < > | = resize it. Change the leader on the Vim mode page", "DOM"],
        ["[  ]", "Previous / next channel without leaving the message list", "DOM"],
        ["{  }  C", "Previous / next community (counts work); C opens the community switcher. j / k move in it, Enter picks, Esc closes", "DOM"],
        ["o  Enter", "Open the thread of the message under the cursor and move into it. Enter only while the message list has focus", "API + DOM"],
        ["q", "Close the thread: the active tab of the pane you are in, or of the thread pane from the message list", "DOM"],
        ["zc  zo", "Hide / show the thread pane. Its threads stay open", "DOM"],
        [">  <", "Widen / narrow the thread pane by 48 px a press; a count multiplies (3> is 144 px)", "DOM"],
        ["|  =", "Thread pane as wide as it goes / back to its default width", "DOM"],
        ["r", "Reply in a thread to the message under the cursor; focus lands in the reply box", "DOM"],
        ["m", "Open the menu of the message under the cursor (copy, mark unread, ...). j / k move, Enter picks", "DOM"],
        ["gt  gT", "Next / previous page, cycling through the pages the app lists", "API"],
        ["gi gm ga gr gw gv gs", "Open Inbox, Messages, Agents, Reminders, Workflows, the Vim mode page (its switches), Settings (the page whose name starts with the letter). The app has Cmd+, or Ctrl+, for Settings too", "API"],
        ["i  a  A", "Go to INSERT: focus the message box (a: after the character under the caret; A: at the end of the draft)", "API + DOM"],
        ["Esc", "Nothing. It does not close a thread: q does", "DOM"],
        ["/", "Search this conversation (presses the host's own chord)", "API-adjacent"],
        ["?", "Show this list over the page. j k, Ctrl-d Ctrl-u and gg G scroll it; q, Esc or ? closes it", "DOM"],
        ["j  k  l  Enter  h", "Only in the Settings dialog (every other dialog and menu keeps the keys off): j k move through its sections, l or Enter opens one and goes into it (j k then scroll it), h comes back to the list. Esc closes the dialog, as it always did", "DOM"],
        [apple ? "⌘⇧E" : "Ctrl+Shift+E", "Turn Vim keys on or off", "API"],
      ],
    },
    {
      title: "NORMAL, the message box",
      intro: "Inside the message box (Esc from INSERT, or down from the messages with j). The label says NORMAL; plain keys move and edit, they never type.",
      rows: [
        ["h  j  k  l", "Move the caret (counts work)"],
        ["k  (on the first row)", "Go up out of the box into the newest message of the pane"],
        ["Ctrl-e  Ctrl-y", "Scroll the pane's messages one line down / up, the draft untouched (counts work). Not in INSERT: there the editor keeps them"],
        ["h  (at the very start)  l  (at the very end)", "Go one pane left or right: the thread's box is right of the channel's, which is right of the channel list (nothing lies right of the thread)"],
        [`${L}  then  h  l  q  <  >  |  =`, "The leader key works here too, from anywhere in the draft: h and l go one pane left or right, q closes the thread, < > | = resize it"],
        ["w  b  e  ge", "Words: letters, digits and underscore are one word, any other run of characters is another"],
        ["W  B  E  gE", "WORDs: any run of non-blank characters"],
        ["0  ^  $", "Start of the line, first non-blank, end of the line. A line runs between two line breaks, however it wraps"],
        ["gg  G  3G", "First line, last line, line 3 (of the draft)"],
        ["f t F T + a character", "Find that character on this line: onto it, just before it, and the same backwards. 2fx finds the second x"],
        ["; ,", "Repeat the last f t F T, and repeat it the other way"],
        ["i  a  I  A", "Back to INSERT"],
        ["x  dd  dw  de  df,  d$ ...", "Delete: d and any motion above (dd is the whole line). The motions that land on a character take it too"],
        ["u", "Undo"],
        ["v  V", "VISUAL: highlight by character / by line"],
        ["?", "Show this list over the page"],
        ["Esc", "Cancels a half-typed command (d, g, f ...); otherwise nothing: Esc stays in NORMAL. Leave the box with k on its first row, h or l at the ends of the draft, or the leader key"],
      ],
    },
    {
      title: "INSERT",
      intro: "Typing in the message box. The label says INSERT; plain keys type, and the app's own shortcuts apply.",
      rows: [["Esc", "Back to NORMAL, in the box. In a thread's reply box it does not close the thread", "API + DOM"]],
    },
    {
      title: "VISUAL",
      intro: "A highlight in the message box (v or V from NORMAL). The label says VISUAL or VISUAL LINE.",
      rows: [
        ["every NORMAL motion", "Move the cursor end of the highlight (counts work)"],
        ["v  V", "The same key again leaves; the other one switches between characters and lines"],
        ["y", "Copy the highlight to the clipboard"],
        ["d  x", "Delete the highlight (V takes the whole lines)"],
        ["c", "Delete the highlight and go to INSERT"],
        ["Esc", "Back to NORMAL, the caret on the cursor end"],
      ],
    },
  ];
};
