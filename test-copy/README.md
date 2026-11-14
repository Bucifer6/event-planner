# Test copy on your own computer

A private preview of EventDesk.ro that only this computer can reach. It is not a deployment:
nothing is public, no real email is sent, and the data is throwaway.

**You need:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

| To do this | Double-click |
| --- | --- |
| Start (first time takes several minutes) | `start.cmd` |
| Read the sign-in code the app "emailed" | `sign-in-code.cmd` |
| Give an account access to the staff console | `make-staff.cmd` |
| Stop (keeps your test data) | `stop.cmd` |
| Delete all test data | `erase.cmd` |

Then open <http://localhost:3000>.

**Signing in.** Type any email address on the sign-in page, then run `sign-in-code.cmd` to see
the six-digit code. Or choose the account without email, which needs no code.

**Staff console.** Sign in once with an email, run `make-staff.cmd` with that email, turn on
two-step sign-in under *Cont*, sign out and in again, then open <http://localhost:3000/console>.

**Updating.** After new code is merged: pull the latest `main`, then run `start.cmd` again.

This setup was written but could not be run where it was written (no Docker there). If
`start.cmd` stops with an error, copy the last lines of the window and send them over.
