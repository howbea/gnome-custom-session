/*SPDX-License-Identifier: GPL-2.0-or-later*/

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const OptionsGroup = GObject.registerClass(
class OptionsGroup extends Adw.PreferencesGroup {
    _init(settings) {
        super._init({ title: 'Preferences' });

        //settings = this.ExtensionUtils.getSettings();
        
        const Switch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('files-app',
            Switch, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const row = new Adw.ActionRow({
            title: 'Show Files',
            activatable_widget: Switch,
        });
        row.add_suffix(Switch);
        this.add(row);
        
        const Switch2 = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('single-window',
            Switch2, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const row2 = new Adw.ActionRow({
            title: 'Title for single window',
            activatable_widget: Switch2,
        });
        row2.add_suffix(Switch2);
        this.add(row2);
        
        const Switch3 = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('show-special',
            Switch3, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const row3 = new Adw.ActionRow({
            title: 'Show Special Folders',
            activatable_widget: Switch3,
        });
        row3.add_suffix(Switch3);
        this.add(row3);
        
        const Switch4 = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('show-bookmarks',
            Switch4, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const row4 = new Adw.ActionRow({
            title: 'Show Bookmarked Folders',
            activatable_widget: Switch4,
        });
        row4.add_suffix(Switch4);
        this.add(row4);
        
        const Switch5 = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('show-app-icon',
            Switch5, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const row5 = new Adw.ActionRow({
            title: 'Show AppMenu Icon',
            activatable_widget: Switch5,
        });
        row5.add_suffix(Switch5);
        this.add(row5);
        
        const Switch6 = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('show-place-icons',
            Switch6, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const row6 = new Adw.ActionRow({
            title: 'Show Files Action Icons',
            activatable_widget: Switch6,
        });
        row6.add_suffix(Switch6);
        this.add(row6);
    }
});

export default class GAppMenuPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage();
    const optionsgroup = new OptionsGroup(settings);
    page.add(optionsgroup);
    window.add(page);
    }
}
