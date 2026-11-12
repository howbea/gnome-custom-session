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

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Atk from 'gi://Atk';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import AccountsService from 'gi://AccountsService';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as userWidget from 'resource:///org/gnome/shell/ui/userWidget.js';
import * as AppFavorites from "resource:///org/gnome/shell/ui/appFavorites.js";
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';

const HOT_CORNER_PRESSURE_THRESHOLD = 100;
const HOT_CORNER_PRESSURE_TIMEOUT = 1000;


var AggregateLayout = GObject.registerClass(
class AggregateLayout extends Clutter.BoxLayout {
    _init(params = {}) {
        params['orientation'] = Clutter.Orientation.VERTICAL;
        super._init(params);

        this._sizeChildren = [];
    }

    addSizeChild(actor) {
        this._sizeChildren.push(actor);
        this.layout_changed();
    }

    vfunc_get_preferred_width(container, forHeight) {
        let themeNode = container.get_theme_node();
        let minWidth = themeNode.get_min_width();
        let natWidth = minWidth;

        for (let i = 0; i < this._sizeChildren.length; i++) {
            let child = this._sizeChildren[i];
            let [childMin, childNat] = child.get_preferred_width(forHeight);
            minWidth = Math.max(minWidth, childMin);
            natWidth = Math.max(natWidth, childNat);
        }
        return [minWidth, natWidth];
    }
});

export const HotCornerPlus = GObject.registerClass(
class HotCornerPlus extends Clutter.Actor {
    _init(layoutManager, monitor) {
        super._init();

        this._monitor = monitor;

        this._pressureBarrier = new Layout.PressureBarrier(
            HOT_CORNER_PRESSURE_THRESHOLD,
            HOT_CORNER_PRESSURE_TIMEOUT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);

        this._pressureBarrier.connect(
            'trigger',
            this._toggleOverview.bind(this));

        this._horizontalBarrier = null;

        this.connect('destroy', this._onDestroy.bind(this));
    }

    setBarrierSize(size) {
    if (this._verticalBarrier) {
        this._pressureBarrier.removeBarrier(this._verticalBarrier);
        this._verticalBarrier.destroy();
        this._verticalBarrier = null;
    }

    if (this._horizontalBarrier) {
        this._pressureBarrier.removeBarrier(this._horizontalBarrier);
        this._horizontalBarrier.destroy();
        this._horizontalBarrier = null;
    }

    if (size > 0) {
        this._verticalBarrier = new Meta.Barrier({
            backend: global.backend,
            x1: this._monitor.x,
            x2: this._monitor.x,
            y1: this._monitor.y,
            y2: this._monitor.y + size,
            directions: Meta.BarrierDirection.POSITIVE_X,
        });

        this._horizontalBarrier = new Meta.Barrier({
            backend: global.backend,
            x1: this._monitor.x,
            x2: this._monitor.x + this._monitor.width,
            y1: this._monitor.y,
            y2: this._monitor.y,
            directions: Meta.BarrierDirection.POSITIVE_Y,
        });

        this._pressureBarrier.addBarrier(this._verticalBarrier);
        this._pressureBarrier.addBarrier(this._horizontalBarrier);
    }
}

    _onDestroy() {
        this.setBarrierSize(0);

        this._pressureBarrier.destroy();
        this._pressureBarrier = null;
    }

    _toggleOverview() {
        if (this._monitor.inFullscreen && !Main.overview.visible)
            return;

        if (Main.overview.shouldToggleByCornerOrButton())
            Main.overview.toggle();
    }
});

const ActivitiesMenuButton = GObject.registerClass(
class ActivitiesMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, null);
        
        this.menu.actor.add_style_class_name('main-menu');

        let menuLayout = new AggregateLayout();
        this.menu.box.set_layout_manager(menuLayout);
        this.menu.box.add_style_class_name('main-menu');

        this.set({
            name: 'panelActivitiesMenu',
            accessible_role: Atk.Role.TOGGLE_BUTTON,
            /* Translators: If there is no suitable word for "Activities"
               in your language, you can use the word for "Overview". */
            accessible_name: _('ActivitiesMenu'),
        });
        
        let bin = new St.Bin({name: 'activitiesMenu'});
        this.add_child(bin);
        
        this._container = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        bin.set_child(this._container);
        
        this._iconBox = new St.Bin({
        y_align: Clutter.ActorAlign.CENTER,
        });         
        this._container.add_child(this._iconBox);        
          
        this._label = new St.Label({
            //text: _('debian'),
            text: "\uE001",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'activities-label',
        });        
        //this._container.add_child(this._label);
        
        const icon = new St.Icon({
            //icon_name: 'debian-logo-symbolic',
            icon_name: 'start-here-symbolic',
            style_class: 'activities-icon',
        });
        this._iconBox.set_child(icon);
        
        this.label_actor = this._label;
        
        this._systemActions = new SystemActions.getDefault();

        this._createSubMenu();
        
        this._loginScreenItem.connect('notify::visible',
            () => this._updateSessionSubMenu());
        this._logoutItem.connect('notify::visible',
            () => this._updateSessionSubMenu());
        this._suspendItem.connect('notify::visible',
            () => this._updateSessionSubMenu());
        this._powerOffItem.connect('notify::visible',
            () => this._updateSessionSubMenu());
        this._restartItem.connect('notify::visible',
            () => this._updateSessionSubMenu());
        // Whether shutdown is available or not depends on both lockdown
        // settings (disable-log-out) and Polkit policy - the latter doesn't
        // notify, so we update the menu item each time the menu opens or
        // the lockdown setting changes, which should be close enough.
        
        this.menu.connect('open-state-changed', (menu, open) => {
            if (!open)
                return;
            this._systemActions.forceUpdate();
            this.update();
            this.smappsitem.menu.removeAll();
            this.submenubuild();
        });
        
        this._updateSessionSubMenu();

        Main.sessionMode.connect('updated', this._sessionUpdated.bind(this));
        this._sessionUpdated();
        
        this.smappsitem = new PopupMenu.PopupSubMenuMenuItem(_('Recent Items'), true);
        this.smappsitem.icon.icon_name = 'document-open-recent-symbolic';

        /*this._showingSignal = Main.overview.connect('showing', () => {
            this.add_style_pseudo_class('checked');
            this.add_accessible_state(Atk.StateType.CHECKED);
        });        
        
        this._hidingSignal = Main.overview.connect('hiding', () => {
            this.remove_style_pseudo_class('checked');
            this.remove_accessible_state(Atk.StateType.CHECKED);
        });*/

        this._xdndTimeOut = 0;
        
        this.menu_build();
        
        /*this.smappsitem.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                this.smappsitem.menu.removeAll();
                this.submenubuild();
                }
        });*/  
    }
    
    _sessionUpdated() {
        this._settingsItem.visible = Main.sessionMode.allowSettings;
    }

    _updateSessionSubMenu() {
        this._sessionSubMenu.visible =
            this._loginScreenItem.visible ||
            this._logoutItem.visible ||
            this._suspendItem.visible ||
            this._restartItem.visible ||
            this._powerOffItem.visible;
    }

    _createSubMenu() {
        let bindFlags = GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE;
        let item;
        
        var userManager = AccountsService.UserManager.get_default();
        var user = userManager.get_user(GLib.get_user_name());
        
        this._sessionSubMenu = new PopupMenu.PopupSubMenuMenuItem(
            _('Power Off…'), true, {});
        this._sessionSubMenu.icon.icon_name = 'system-shutdown-symbolic';        

        item = new PopupMenu.PopupImageMenuItem(
            this._systemActions.getName('lock-orientation'),
            this._systemActions.orientation_lock_icon);

        item.connect('activate', () => {
            this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
            this._systemActions.activateLockOrientation();
        });
        //this.menu.addMenuItem(item);
        this._orientationLockItem = item;
        this._systemActions.bind_property('can-lock-orientation',
            this._orientationLockItem, 'visible',
            bindFlags);
        this._systemActions.connect('notify::orientation-lock-icon', () => {
            let iconName = this._systemActions.orientation_lock_icon;
            let labelText = this._systemActions.getName("lock-orientation");
            this._orientationLockItem.setIcon(iconName);
            this._orientationLockItem.label.text = labelText;
        });

        let app = this._settingsApp = Shell.AppSystem.get_default().lookup_app(
            'gnome-control-center.desktop');
        if (app) {
            const [icon] = app.app_info.get_icon().names;
            const name = app.app_info.get_name();
            item = new PopupMenu.PopupImageMenuItem(name, icon);
            item.connect('activate', () => {
                this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
                Main.overview.hide();
                this._settingsApp.activate();
            });
            this.menu.addMenuItem(item);
            this._settingsItem = item;
        } else {
            log('Missing required core component Settings, expect trouble…');
            this._settingsItem = new St.Widget();
        }
            
        item = new PopupMenu.PopupMenuItem(_('Suspend'));
        item.connect('activate', () => {
            this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
            this._systemActions.activateSuspend();
        });
        this._sessionSubMenu.menu.addMenuItem(item);
        this._suspendItem = item;
        this._systemActions.bind_property('can-suspend',
            this._suspendItem, 'visible',
            bindFlags);

        item = new PopupMenu.PopupMenuItem(_('Restart…'));
        item.connect('activate', () => {
            this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
            this._systemActions.activateRestart();
        });
        this._sessionSubMenu.menu.addMenuItem(item);
        this._restartItem = item;
        this._systemActions.bind_property('can-restart',
            this._restartItem, 'visible',
            bindFlags);

        item = new PopupMenu.PopupMenuItem(_('Power Off…'));
        item.connect('activate', () => {
            this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
            this._systemActions.activatePowerOff();
        });
        this._sessionSubMenu.menu.addMenuItem(item);
        this._powerOffItem = item;
        this._systemActions.bind_property('can-power-off',
            this._powerOffItem, 'visible',
            bindFlags);
            
        function getName() {
            return user.get_real_name() || user.get_user_name();
        }
        let name;
        name = getName();
        this.sppop = new PopupMenu.PopupSeparatorMenuItem(name);
        this._sessionSubMenu.menu.addMenuItem(this.sppop);
        this.sppop.add_style_class_name = 'sppop';
        
        //this._sessionSubMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        item = new PopupMenu.PopupImageMenuItem(_('Lock'), 'changes-prevent-symbolic');
        item.connect('activate', () => {
            this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
            this._systemActions.activateLockScreen();
        });
        //this.menu.addMenuItem(item);
        this._lockScreenItem = item;
        this._systemActions.bind_property('can-lock-screen',
            this._lockScreenItem, 'visible',
            bindFlags);            
        //this._sessionSubMenu.menu.addMenuItem(this._lockScreenItem);
        
        item = new PopupMenu.PopupMenuItem(_('Log Out…'));
        item.connect('activate', () => {
            this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
            this._systemActions.activateLogout();
        });
        this._sessionSubMenu.menu.addMenuItem(item);
        this._logoutItem = item;
        
        
        
        this.update = () => {
            name = getName();
            //this._logoutItem.label.text = _('Log Out %s…').format(name);
            this.sppop.label.text = name;
        };
        this.update();
        
        this._systemActions.bind_property('can-logout',
            this._logoutItem, 'visible',
            bindFlags);

        item = new PopupMenu.PopupMenuItem(_('Switch User…'));
        item.connect('activate', () => {
            this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
            this._systemActions.activateSwitchUser();
        });
        this._sessionSubMenu.menu.addMenuItem(item);
        this._loginScreenItem = item;
        this._systemActions.bind_property('can-switch-user',
            this._loginScreenItem, 'visible',
            bindFlags);
            
        //this._sessionSubMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            
        let usersapp = this._settingsUsersApp = Shell.AppSystem.get_default().lookup_app(
            'gnome-users-panel.desktop');
        if (usersapp) {
            const [icon] = usersapp.app_info.get_icon().names;
            const usname = usersapp.app_info.get_name();
            //item = new PopupMenu.PopupMenuItem('User Settings');
            item = new PopupMenu.PopupMenuItem(usname);
            item.connect('activate', () => {
                this.menu.itemActivated(BoxPointer.PopupAnimation.NONE);
                Main.overview.hide();
                this._settingsUsersApp.activate();
            });
            //this._sessionSubMenu.menu.addMenuItem(item);
            this._settingsUsersItem = item;
        } else {
            log('Missing required core component Settings, expect trouble…');
            this._settingsUsersItem = new St.Widget();
        }
    }
    
    add_item(app) {
        const space_widget = new St.Widget({style_class: 'space-widget'});
        let item = new PopupMenu.PopupMenuItem('', {style_class: 'items-item'}); //BaseMenuItem;
        this.smappsitem.menu.addMenuItem(item);
        //let box = new St.BoxLayout({vertical: false, style_class: 'items-box'});
        //item.actor.add_child(box);
        let icon = app.create_icon_texture(16);
        item.insert_child_at_index(icon, 0);
        //item.insert_child_at_index(space_widget, 0);
        //box.add_child(icon);
        let label = new St.Label({text: app.get_name(),
                                  y_align: Clutter.ActorAlign.CENTER,});
        //box.add_child(label);
        item.label.text = app.get_name();
        
        item.connect("activate", () => {
            app.open_new_window(-1);
            //Main.overview.hide();
            });
    }
    
    submenubuild() {    
    let count = 0;
        Shell.AppUsage.get_default().get_most_used().forEach((app) => {
            if (count < 5) {
            this.add_item(app);
            count++;
            }
        });

        const separator = new PopupMenu.PopupSeparatorMenuItem(_('Applications'));
        const separator2 = new PopupMenu.PopupSeparatorMenuItem(_('Documents'));
        
        let space_widget = new St.Widget({style_class: 'space-widget'});
        //separator.insert_child_at_index(space_widget, 0);
        let space_widget2 = new St.Widget({style_class: 'space-widget'});
        //separator2.insert_child_at_index(space_widget2, 0);
        
        this.smappsitem.menu.addMenuItem(separator2);
        this.smappsitem.menu.addMenuItem(separator, 0);
        
        const MAX_ITEMS = 7; //this._settings.get_int('max-items'); // ← gsettings から取得

    const bookmark = new GLib.BookmarkFile();
    const xbelPath = GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local/share/recently-used.xbel'
    ]);

    try {
        bookmark.load_from_file(xbelPath);

        const items = bookmark.get_uris();

        if (items.length === 0) {
            this.smappsitem.menu.addMenuItem(
                new PopupMenu.PopupMenuItem("No recent files", { reactive: false, style_class: 'items-item'})
            );
            return;
        }

        // 最新順に並び替え
        const sorted = items.sort((a, b) => {
            const ta = bookmark.get_modified(a);
            const tb = bookmark.get_modified(b);
            return tb - ta;
        });

        // ★ 表示用に最大 MAX_ITEMS 件集める
        const filteredItems = [];

        for (const uri of sorted) {
            if (filteredItems.length >= MAX_ITEMS)
                break;

            const file = Gio.File.new_for_uri(uri);

            // 1) ファイルがない → スキップ
            if (!file.query_exists(null)) {
                continue;
            }

            // 2) ディレクトリ → スキップ
            const infoBasic = file.query_info(
                'standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            if (infoBasic.get_file_type() === Gio.FileType.DIRECTORY) {
                continue;
            }

            filteredItems.push(uri);
        }

        // ★ 表示
        if (filteredItems.length === 0) {
            this._indicator.menu.addMenuItem(
                new PopupMenu.PopupMenuItem("No recent files", { reactive: false, style_class: 'items-item'})
            );
            return;
        }

        for (const uri of filteredItems) {
            const file = Gio.File.new_for_uri(uri);

            const info = file.query_info(
                'standard::icon,standard::display-name',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            const gicon = info.get_icon();
            const displayName = info.get_display_name();

            const item = new PopupMenu.PopupMenuItem('', {style_class: 'items-item'});

            const icon = new St.Icon({
                gicon,
                icon_size: 16,
                //style_class: 'popup-menu-icon'
            });
            
            const space_widget = new St.Widget({style_class: 'space-widget'});
            item.insert_child_at_index(icon, 0);
            //item.insert_child_at_index(space_widget, 0);
            item.label.text = displayName;            

            item.connect('activate', () => {

    // ★ XBEL のパス
    const xbelPath = GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local/share/recently-used.xbel'
    ]);

    try {
        const bookmark2 = new GLib.BookmarkFile();
        bookmark2.load_from_file(xbelPath);

        // ★ now を UNIX タイムスタンプ（秒）で取得
        //const now = Math.floor(Date.now() / 1000);

        // ★ タイムスタンプ更新
        //bookmark2.set_modified(uri, now);

        // ★ 保存
        //bookmark2.to_file(xbelPath);

    } catch (e) {
        log(`XBEL update error: ${e}`);
    }

    // ★ 最後にファイルを開く
    Gio.AppInfo.launch_default_for_uri(uri, null);
});
            
        this.smappsitem.menu.addMenuItem(item);
    }

    } catch (e) {
        //this.smappsitem._indicator.menu.addMenuItem(
        this.smappsitem.menu.addMenuItem(
            new PopupMenu.PopupMenuItem(`Error: ${e}`, { reactive: false })
        );
    }
    
    }
    
    menu_build() {
        let bindFlags = GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE;
        let iteml;
        
        this.submenubuild();
        
        
        let itemsettings = new PopupMenu.PopupImageMenuItem(_('Settings…'), 'org.gnome.Settings-symbolic');
        itemsettings.connect('activate', () => {
        Shell.AppSystem.get_default().lookup_app('org.gnome.Settings.desktop').activate();
        });
        
        let itemsystem = new PopupMenu.PopupImageMenuItem(_('System Settings…'), 'org.gnome.Settings-system-symbolic');
        itemsystem.connect('activate', () => {
        Shell.AppSystem.get_default().lookup_app('gnome-system-panel.desktop').activate();
        });
        
        let itemsoftware = new PopupMenu.PopupImageMenuItem(_('Software Updates'), 'org.gnome.Software-symbolic');
        itemsoftware.connect('activate', () => {
        //Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop').activate();
        Util.spawn(['gnome-software', '--mode=updates']);
        });
        
        let itemabout = new PopupMenu.PopupImageMenuItem(_('About'), 'org.gnome.Settings-about-symbolic');
        itemabout.connect('activate', () => {
        Shell.AppSystem.get_default().lookup_app('gnome-about-panel.desktop').activate();
        });
        
        let itemhelp = new PopupMenu.PopupImageMenuItem(_('Help'), 'help-browser-symbolic');
        itemhelp.connect('activate', () => {
            if (Shell.AppSystem.get_default().lookup_app('yelp.desktop')) {
                Shell.AppSystem.get_default().lookup_app('yelp.desktop').activate();
            }
            else {
            Gio.AppInfo.launch_default_for_uri_async('https://discourse.gnome.org/', global.create_app_launch_context(0, -1), null)
            }
        });    
        
        const itemScreenshot =
            new PopupMenu.PopupImageMenuItem(
                _('Take Screenshot'),
                'screenshooter-symbolic'
            );

        itemScreenshot.connect('activate', () => {
            const laters = global.compositor.get_laters();

            laters.add(
                Meta.LaterType.BEFORE_REDRAW,
                () => {
                    Main.screenshotUI.open().catch(logError);
                    return GLib.SOURCE_REMOVE;
                }
            );
            this.menu.close();
        });
        
        
        /*add menus*/
        
        this.menu.addMenuItem(this._sessionSubMenu);
        this.menu.addMenuItem(this._lockScreenItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(itemScreenshot);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        //this.menu.addMenuItem(this.smappsitem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
       
        this.menu.addMenuItem(itemsettings);
        //this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        //this.menu.addMenuItem(itemsoftware);
        
        this.menu.addMenuItem(itemhelp);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(itemabout);
        
    }
    
    _updateHotCorners() {    
        Main.layoutManager._destroyHotCorners();

        const size = Main.layoutManager.panelBox.height;

        for (const monitor of Main.layoutManager.monitors) {
            const hotCornerPlus = new HotCornerPlus(
                Main.layoutManager,
                monitor,
            );

            hotCornerPlus.setBarrierSize(size);

            Main.layoutManager.hotCorners.push(hotCornerPlus);
        }
        Main.layoutManager.emit('hot-corners-changed');
    }

    handleDragOver(source, _actor, _x, _y, _time) {
        if (source !== Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;

        if (this._xdndTimeOut !== 0)
            GLib.source_remove(this._xdndTimeOut);
        this._xdndTimeOut = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BUTTON_DND_ACTIVATION_TIMEOUT, () => {
            this._xdndToggleOverview();
        });
        GLib.Source.set_name_by_id(this._xdndTimeOut, '[gnome-shell] this._xdndToggleOverview');

        return DND.DragMotionResult.CONTINUE;
    }
    
    vfunc_event(event) {    
        if (event.type() == Clutter.EventType.TOUCH_END ||
            event.type() == Clutter.EventType.BUTTON_RELEASE) {
            if (Main.overview.shouldToggleByCornerOrButton()) {
                //Main.overview.toggle();
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
        //return Main.wm.handleWorkspaceScroll(event);
    }

    vfunc_key_release_event(keyEvent) {
        let symbol = keyEvent.keyval;
        if (symbol == Clutter.KEY_Return || symbol == Clutter.KEY_space) {
            if (Main.overview.shouldToggleByCornerOrButton()) {
                //Main.overview.toggle();
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _xdndToggleOverview() {
        let [x, y] = global.get_pointer();
        let pickedActor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);

        if (pickedActor === this && Main.overview.shouldToggleByCornerOrButton())
            //Main.overview.toggle();
            this.menu.toggle();

        GLib.source_remove(this._xdndTimeOut);
        this._xdndTimeOut = 0;
        return GLib.SOURCE_REMOVE;
    }
    
    destroy() {
        if (this._showingSignal) {
            Main.overview.disconnect(this._showingSignal);
            this._showingSignal = null;
        }

        if (this._hidingSignal) {
            Main.overview.disconnect(this._hidingSignal);
            this._hidingSignal = null;
        }

        if (this._xdndTimeOut) {
            GLib.Source.remove(this._xdndTimeOut);
            this._xdndTimeOut = null;
        }        
        super.destroy();
    }
});

export default class IndicatorExampleExtension extends Extension {

    enable() {
        if (Main.panel.statusArea['activities'])
            Main.panel.statusArea['activities'].hide();
        this._indicator = new ActivitiesMenuButton();
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'left');
        
        const controls = Main.overview._overview.controls;
        const appDisplay = controls.appDisplay;
        appDisplay.add_style_class_name('applications-panel');
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        if (Main.panel.statusArea['activities']) {
        if (Main.sessionMode.currentMode !== 'unlock-dialog')
            Main.panel.statusArea['activities'].show();}
    }
}
