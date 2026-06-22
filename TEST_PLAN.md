# Workflow01 Test Plan

1. Create workspace A and open three tabs.
2. Create workspace B and confirm A keeps its tabs.
3. Add tabs to B and switch A/B repeatedly.
4. Create workspace C from B while on a new tab and confirm B keeps that new tab.
5. Delete active B and confirm Workflow01 switches to previous workspace without closing Firefox.
6. Restart Firefox and confirm the last active workspace restores.
7. Open a private window and confirm Workflow01 does not operate there.
8. Restore a privileged URL and confirm the failed URL becomes a blank tab instead of breaking restore.
