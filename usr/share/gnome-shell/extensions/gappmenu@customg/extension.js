/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Overview from 'resource:///org/gnome/shell/ui/overview.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PlacesManager} from './placeDisplay.js';

const N_ = x => x;

const PANEL_ICON_SIZE = 16;
const APP_MENU_ICON_MARGIN = 0;

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

class PlaceMenuItem extends PopupMenu.PopupImageMenuItem {
    static {
        GObject.registerClass(this);
    }
    
    constructor(info, appMenuButton, showIcon) {
        super(info.name, info.icon, {
            style_class: 'place-menu-item',
        });
        
        this._info = info;
        
        this._appMenuButton = appMenuButton;
        
        this._icon.visible = showIcon;

        if (info.isRemovable()) {
            this._ejectIcon = new St.Icon({
                icon_name: 'media-eject-symbolic',
                style_class: 'popup-menu-icon',
            });
            this._ejectButton = new St.Button({
                child: this._ejectIcon,
                style_class: 'button',
            });
            this._ejectButton.connect('clicked', info.eject.bind(info));
            this.add_child(this._ejectButton);
        }

        info.connectObject('changed',
            this._propertiesChanged.bind(this), this);
    }

    activate(event) {
        this._info.launch(event.get_time());
        this._appMenuButton.menu.close();

        super.activate(event);
    }

    _propertiesChanged(info) {
        this.setIcon(info.icon);
        this.label.text = info.name;
    }
}

const SECTIONS = [
    'special',
    'devices',
    'bookmarks',
    'network',
];

const AppMenuButton = GObject.registerClass({
    Signals: {'changed': {}},
}, class AppMenuButton extends PanelMenu.Button {
    _init(panel, settings) {
        super._init(0.0, null, true);

        this.accessible_role = Atk.Role.MENU;
        this._settings = settings;
        this._startingApps = [];
        this._menuManager = panel.menuManager;
        this._targetApp = null;
        this.placesManager = null;

        let bin = new St.Bin({name: 'appMenu'});
        this.add_child(bin);

        this.bind_property('reactive', this, 'can-focus', 0);
        this.reactive = false;

        this._container = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        bin.set_child(this._container);

        let textureCache = St.TextureCache.get_default();
        textureCache.connectObject(
            'icon-theme-changed',
            this._onIconThemeChanged.bind(this),
            this
        );

        let iconEffect = new Clutter.DesaturateEffect();
        this._iconBox = new St.Bin({
            style_class: 'app-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._iconBox.visible =
            this._settings.get_boolean('show-app-icon');

        this._settings.connectObject(
            'changed::show-app-icon',
            () => {
             this._iconBox.visible =
                    this._settings.get_boolean('show-app-icon');
            },
            this
        );
        
        this._iconBox.add_effect(iconEffect);
        this._container.add_child(this._iconBox);

        this._iconBox.connectObject(
            'style-changed',
            () => {
                let themeNode = this._iconBox.get_theme_node();
                iconEffect.enabled = themeNode.get_icon_style() === St.IconStyle.SYMBOLIC;
            },
            this
        );

        this._label = new St.Label({
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._container.add_child(this._label);

        this._visible = !Main.overview.visible;
        if (!this._visible)
            this.hide();
        Main.overview.connectObject(
            'hiding', this._sync.bind(this),
            'showing', this._sync.bind(this), this);

        this._spinner = new Animation.Spinner(PANEL_ICON_SIZE, {
            animate: true,
            hideOnStop: true,
        });
        this._container.add_child(this._spinner);

        this._buildMenu();

        /*this._settingsID = this._settings.connect('changed::single-window', () => {
            this._buildMenu();
        });*/
        
        this._settingsID = this._settings.connect('changed', () => {
            this._buildMenu();
        });

        Shell.WindowTracker.get_default().connectObject('notify::focus-app',
            this._focusAppChanged.bind(this), this);
        Shell.AppSystem.get_default().connectObject('app-state-changed',
            this._onAppStateChanged.bind(this), this);
        global.window_manager.connectObject('switch-workspace',
            this._sync.bind(this), this);

        this._sync();
    }

    _cleanPlacesManager() {
        if (this.placesManager) {
            this.placesManager.disconnectObject(this);
            this.placesManager.destroy();
            this.placesManager = null;
        }
    }

    _buildMenu() {
        this._cleanPlacesManager();

        if (this.menu) {
            this.menu.close();
            this.menu.destroy();
        }

        let menu;

        if (this._settings.get_boolean('single-window')) {
            menu = new AppMenu(this, St.Side.TOP, {
                favoritesSection: false,
                showSingleWindows: true,
            });
        } else {
            menu = new AppMenu(this);
        }

        this.setMenu(menu);
        this._menuManager.addMenu(menu);

        menu.actor.add_style_class_name('panel-app-menu');
        menu.setApp(this._targetApp);

        if (this._targetApp?.get_id() === 'org.gnome.Nautilus.desktop') {
            this._addFilesActions(menu);
        }
    }

    _addFilesActions(menu) {
    this.placesManager = new PlacesManager();
    this._sections = {};

    for (const id of SECTIONS) {
        if (!this._settings.get_boolean(`show-${id}`))
            continue;

        const section = new PopupMenu.PopupMenuSection();
        this._sections[id] = section;

        this.placesManager.connectObject(
            `${id}-updated`,
            () => this._redisplay(id),
            this
        );

        this._create(id);
    }

    const index = menu.box.get_children().indexOf(
    menu._actionSection.actor
    );

    const ids = SECTIONS.filter(id => this._sections[id]);

    let offset = 1;

    for (let i = 0; i < ids.length; i++) {
        const section = this._sections[ids[i]];

        menu.box.insert_child_at_index(
            section.actor,
            index + offset
        );
            offset++;

        if (i < ids.length - 1) {
            menu.box.insert_child_at_index(
                new PopupMenu.PopupSeparatorMenuItem().actor,
                index + offset
            );
            offset++;
        }
    }
}

    fadeIn() {
        if (this._visible)
            return;

        this._visible = true;
        this.reactive = true;
        this.remove_all_transitions();
        this.ease({
            opacity: 255,
            duration: Overview.ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    fadeOut() {
        if (!this._visible)
            return;

        this._visible = false;
        this.reactive = false;
        this.remove_all_transitions();
        this.ease({
            opacity: 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration: Overview.ANIMATION_TIME,
        });
    }

    _syncIcon(app) {
        const icon = app.create_icon_texture(PANEL_ICON_SIZE - APP_MENU_ICON_MARGIN);
        this._iconBox.set_child(icon);
    }

    _onIconThemeChanged() {
        if (this._iconBox.child == null)
            return;

        if (this._targetApp)
            this._syncIcon(this._targetApp);
    }

    stopAnimation() {
        this._spinner.stop();
    }

    startAnimation() {
        this._spinner.play();
    }

    _onAppStateChanged(appSys, app) {
        let state = app.state;
        if (state !== Shell.AppState.STARTING)
            this._startingApps = this._startingApps.filter(a => a !== app);
        else if (state === Shell.AppState.STARTING)
            this._startingApps.push(app);

        this._sync();
    }

    _focusAppChanged() {
        let tracker = Shell.WindowTracker.get_default();
        let focusedApp = tracker.focus_app;
        if (!focusedApp) {
            if (global.stage.key_focus != null)
                return;
        }
        this._sync();
    }

    _findTargetApp() {
        let appSys = Shell.AppSystem.get_default();
        let workspaceManager = global.workspace_manager;
        let workspace = workspaceManager.get_active_workspace();
        let tracker = Shell.WindowTracker.get_default();
        let focusedApp = tracker.focus_app;
        if (focusedApp && focusedApp.is_on_workspace(workspace))
            return focusedApp;

        for (let i = 0; i < this._startingApps.length; i++) {
            if (this._startingApps[i].is_on_workspace(workspace))
                return this._startingApps[i];
        }

        if (this._settings.get_boolean('files-app')) {
            let filesApp = appSys.lookup_app('org.gnome.Nautilus.desktop');
            return filesApp ?? null;
        }

        return null;
    }

    _sync() {
        let targetApp = this._findTargetApp();

        if (this._targetApp !== targetApp) {
            this._targetApp?.disconnectObject(this);

            this._targetApp = targetApp;

            if (this._targetApp) {
                this._targetApp.connectObject('notify::busy', this._sync.bind(this), this);
                this._label.set_text(this._targetApp.get_name());
                this.set_accessible_name(this._targetApp.get_name());

                this._syncIcon(this._targetApp);
            }

            this._buildMenu();
        }

        let visible = this._targetApp != null && !Main.overview.visibleTarget;
        if (visible)
            this.fadeIn();
        else
            this.fadeOut();

        let isBusy = this._targetApp != null &&
                      (this._targetApp.get_state() === Shell.AppState.STARTING ||
                       this._targetApp.get_busy());
        if (isBusy)
            this.startAnimation();
        else
            this.stopAnimation();

        this.reactive = visible && !isBusy;

        this.menu.setApp(this._targetApp);
        this.emit('changed');
    }

    destroy() {
        this._cleanPlacesManager();

        if (this._settingsID) {
            this._settings.disconnect(this._settingsID);
            this._settingsID = null;
        }
        super.destroy();
    }

    _redisplay(id) {
        this._sections[id].removeAll();
        this._create(id);
    }


    _create(id) {
        const places = this.placesManager.get(id);

        for (let i = 0; i < places.length; i++)
            this._sections[id].addMenuItem(
                new PlaceMenuItem(
                    places[i],
                    this,
                    this._settings.get_boolean('show-place-icons')
                )
            );

        this._sections[id].actor.visible = places.length > 0;
    }
    
   
});


export default class IndicatorGAppMenuExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new AppMenuButton(Main.panel, this._settings);
        Main.panel.statusArea['appMenu']?.hide();
        Main.panel.addToStatusArea(this.uuid, this._indicator, -1, 'left');
    }

    disable() {
        this._settings = null;
        this._indicator?.destroy();
        this._indicator = null;
        Main.panel.statusArea['appMenu']?.show();
    }
}
