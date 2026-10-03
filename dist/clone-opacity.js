import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
let original = null;
function proto() {
    return WorkspaceAnimation.WorkspaceGroup.prototype;
}

/**
 * Make workspace-switch clones inherit their source window's opacity.
 *
 * During a workspace switch the shell replaces each window with a
 * `Clutter.Clone`, which paints the source using the CLONE's own paint
 * opacity - 255 by default. A translucent drawer therefore turns fully opaque
 * for the length of the animation and snaps back when it ends. The window
 * actor's own opacity is never touched, so this is purely a painting
 * artefact; copying it onto the clone is enough to fix it.
 *
 * Patching `WorkspaceGroup.prototype` rather than any one caller covers both
 * the stock animation and extensions that build on it (V-Shell constructs the
 * stock `WorkspaceGroup` for its sticky-window group).
 */
export function enableCloneOpacityFix() {
    if (original)
        return;
    const target = proto();
    const orig = target._createClone;
    original = orig;
    target._createClone = function (windowActor) {
        const clone = orig.call(this, windowActor);
        clone.opacity = windowActor.opacity;
        return clone;
    };
}

export function disableCloneOpacityFix() {
    if (!original)
        return;
    proto()._createClone = original;
    original = null;
}
