import {useCallback, useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {Home, type Appearance} from './screens/Home';
import {Settings, type SettingsTab} from './screens/Settings';
import {Picker, type WallpaperChoice} from './screens/Picker';
import {Toast, type ToastMessage} from './components/Toast';
import {Wallpaper} from './components/Wallpaper';
import type {TileModel} from './components/Tile';
import {cacheApps, cachedApps, listApps, type AppEntry} from './lib/apps';
import {sameApps} from './lib/appcache';
import type {TimeFormat} from './lib/clock';
import {listInputs, MOCK_INPUTS, type InputSource} from './lib/inputs';
import {launchApp, launchLgHome} from './lib/launch';
import {isWebOS} from './lib/luna';
import {hidePointerOnForeground} from './lib/pointer';
import {closeHomeAndMeasure, closeLgHome, getHomeApp, LG_HOME_ID, setHomeApp} from './lib/system';
import {getHookStatus, hookMessage, installHomeHook, logLine, markAlive, reapplyHomeHook, removeHomeHook, setBootLink, stockHome} from './lib/homehook';
import {applyPref, findPref, optionsFor, resetLook, type Press, type SystemInfo} from './lib/prefs';
import {loadConfig, saveConfig, toggleId, DEFAULT_WALLPAPER, type UserConfig} from './lib/storage';
import {applyTheme} from './theme/tokens';
import {useTimeFormat} from './hooks/useTimeFormat';
import {appTile, inputTile, pickInOrder} from './lib/tiles';
import {APP_ID, TIMING} from './config/constants';

type Screen = 'home' | 'settings' | 'picker';

const TAB = {apps: 'apps', sources: 'sources', look: 'look', clock: 'clock', wallpaper: 'wallpaper', options: 'options'} as const;
const MISC = {lgHome: 'lg-home', settings: 'settings'} as const;

/** The two tiles that always end the row. */
const MISC_TILES: TileModel[] = [
	{key: MISC.lgHome, label: 'LG Home', glyph: 'house'},
	{key: MISC.settings, label: 'Settings', glyph: 'gear'}
];

export function App () {
	const [screen, setScreen] = useState<Screen>('home');
	const [config, setConfig] = useState<UserConfig>(loadConfig);
	const [apps, setApps] = useState<AppEntry[]>(cachedApps);      // last known list: the row is drawn at once
	const [asleep, setAsleep] = useState(document.hidden);
	const replaceRef = useRef(config.replaceHome);
	const [inputs, setInputs] = useState<InputSource[]>([]);
	const [toast, setToast] = useState<ToastMessage | null>(null);
	const toastTimer = useRef(0);
	const closedAt = useRef(0);
	const [systemInfo, setSystemInfo] = useState<SystemInfo>({homeApp: null, homeHook: null});
	const tvFormat = useTimeFormat();

	// With the hand-over helper on, note in its log how long this launcher took to show its first screen.
	useEffect(() => {
		if (!config.replaceHome || !isWebOS()) return undefined;
		const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
			const began = window.performance && window.performance.timing ? window.performance.timing.navigationStart : 0;
			markAlive();
			if (began) logLine(`launcher: first screen ${Date.now() - began} ms after the page started (hidden: ${document.hidden})`);
		}));
		return () => window.cancelAnimationFrame(frame);
	}, []);

	// Colours follow the theme setting.
	useEffect(() => applyTheme(config.theme), [config.theme]);

	const showToast = useCallback((text: string, kind: ToastMessage['kind'] = 'info') => {
		window.clearTimeout(toastTimer.current);
		setToast({text, kind});
		toastTimer.current = window.setTimeout(() => setToast(null), TIMING.toastMs);
	}, []);

	// Start in remote (5-way) mode: hide the Magic Remote pointer whenever we come to the
	// front. Shaking the remote still brings it back.
	useEffect(() => hidePointerOnForeground(), []);

	// Load apps at start and whenever the Homebrew option changes. With a cached list on screen
	// the real one is fetched a moment later, off the critical path.
	const hadCache = useRef(apps.length > 0);
	useEffect(() => {
		let cancelled = false;
		const load = () => listApps(config.useHomebrew)
			.then(({apps: list, source}) => {
				if (cancelled) return;
				setApps((previous) => (sameApps(previous, list) ? previous : list));
				if (source === 'homebrew') cacheApps(list);
				if (config.useHomebrew && source !== 'homebrew') showToast('Homebrew Channel not available, using the built-in app list', 'error');
			})
			.catch(() => { if (!cancelled) showToast('Could not read the app list', 'error'); });
		const timer = window.setTimeout(load, hadCache.current ? 1200 : 0);
		hadCache.current = false;
		return () => { cancelled = true; window.clearTimeout(timer); };
	}, [config.useHomebrew, showToast]);

	// In the background the launcher lets go of its wallpaper (the big bitmap) and stops its clock, but it
	// keeps its screen: if the TV ever reports "hidden" wrongly, the launcher must still be visible,
	// not a black screen. The state is also re-read every second as a safety net.
	replaceRef.current = config.replaceHome;
	useEffect(() => {
		const sync = (why: string) => {
			const hidden = document.hidden;
			setAsleep((was) => {
				if (was !== hidden && replaceRef.current) {
					logLine(`launcher: ${hidden ? 'hidden' : 'visible'} (${why})`);
					if (!hidden) markAlive();          // the helper checks for this after opening the launcher
				}
				return hidden;
			});
			if (hidden) setScreen('home');
		};
		const onVisibility = () => sync('event');
		document.addEventListener('visibilitychange', onVisibility);
		const poll = window.setInterval(() => sync('check'), 1000);
		return () => { document.removeEventListener('visibilitychange', onVisibility); window.clearInterval(poll); };
	}, []);

	// Inputs are only read when they're needed: some are on the home row, or Settings is open.
	const needInputs = config.sourceIds.length > 0 || screen === 'settings';
	useEffect(() => {
		if (!needInputs) return undefined;
		const refresh = () => {
			if (!isWebOS()) { setInputs(MOCK_INPUTS); return; }
			listInputs().then(setInputs).catch(() => showToast('Could not read the inputs', 'error'));
		};
		refresh();
		const onVisibility = () => { if (!document.hidden) refresh(); };
		document.addEventListener('visibilitychange', onVisibility);
		return () => document.removeEventListener('visibilitychange', onVisibility);
	}, [needInputs, showToast]);

	// Which app the TV's Home button opens: read when Settings opens, so the Options row is right.
	useEffect(() => {
		if (screen === 'settings') Promise.all([getHomeApp(), getHookStatus()]).then(([homeApp, homeHook]) => setSystemInfo({homeApp, homeHook}));
	}, [screen]);

	// Shortly after we come to the front (not at the very first moment, while the TV is still switching
	// apps): make sure the hand-over helper is running (if it is switched on), and end LG's home app to
	// free memory. If we are pushed to the back again within seconds, LG Home has come back in front of
	// us, so "Close LG Home" turns itself off (not needed when the helper is on: it hands straight back).
	useEffect(() => {
		if ((!config.closeHome && !config.replaceHome) || !isWebOS()) return undefined;
		let timer = 0;
		const arm = () => {
			window.clearTimeout(timer);
			if (document.hidden) return;
			timer = window.setTimeout(() => {
				closedAt.current = Date.now();
				if (config.replaceHome) {
					reapplyHomeHook(config.hookBoot).then(({result, detail, fatal}) => {
						if (!fatal) return;
						setConfig((c) => { const next = {...c, replaceHome: false}; saveConfig(next); return next; });
						removeHomeHook();
						showToast(hookMessage(result, detail), 'error');
					});
				}
				closeLgHome();
			}, 1500);
		};
		const onVisibility = () => {
			if (!config.replaceHome && document.hidden && Date.now() - closedAt.current < 2500) {
				setConfig((c) => { const next = {...c, closeHome: false}; saveConfig(next); return next; });
				try { localStorage.setItem('customlauncher-homekill-off', '1'); } catch { /* ignore */ }
			}
			arm();
		};
		arm();
		document.addEventListener('visibilitychange', onVisibility);
		return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
	}, [config.closeHome, config.replaceHome, config.hookBoot, showToast]);

	// Tell the user once if the safety switch-off fired.
	useEffect(() => {
		const onVisibility = () => {
			if (document.hidden) return;
			try {
				if (localStorage.getItem('customlauncher-homekill-off')) {
					localStorage.removeItem('customlauncher-homekill-off');
					showToast('"Close LG Home" was turned off: LG Home kept coming back to the front', 'error');
				}
			} catch { /* ignore */ }
		};
		onVisibility();
		document.addEventListener('visibilitychange', onVisibility);
		return () => document.removeEventListener('visibilitychange', onVisibility);
	}, [showToast]);

	const updateConfig = (next: UserConfig) => { setConfig(next); saveConfig(next); };

	// ----- derived lists -----
	const shownApps = useMemo(
		() => (config.appIds ? pickInOrder(apps, config.appIds, (a) => a.id) : apps),
		[apps, config.appIds]
	);
	const shownInputs = useMemo(() => pickInOrder(inputs, config.sourceIds, (s) => s.appId), [inputs, config.sourceIds]);

	const homeItems: TileModel[] = useMemo(
		() => shownApps.map(appTile).concat(shownInputs.map(inputTile), MISC_TILES),
		[shownApps, shownInputs]
	);

	const timeFormat: TimeFormat = config.clockFormat === 'tv' ? tvFormat : config.clockFormat;

	const tabs: SettingsTab[] = useMemo(() => [
		{id: TAB.apps, label: 'Apps', noun: 'apps', items: apps.map(appTile), shown: shownApps.map(appTile)},
		{id: TAB.sources, label: 'Sources', noun: 'sources', items: inputs.map(inputTile), shown: shownInputs.map(inputTile)},
		{id: TAB.look, label: 'Look', noun: '', items: [], shown: [], options: optionsFor('look', config)},
		{id: TAB.clock, label: 'Clock', noun: '', items: [], shown: [], options: optionsFor('clock', config)},
		{id: TAB.wallpaper, label: 'Wallpaper', noun: '', items: [], shown: [], options: optionsFor('wallpaper', config)},
		{id: TAB.options, label: 'Options', noun: '', items: [], shown: [], options: optionsFor('options', config, systemInfo)}
	], [apps, inputs, shownApps, shownInputs, config, systemInfo]);

	const appearance: Appearance = useMemo(
		() => ({iconScale: config.iconScale, sideMargin: config.sideMargin, bottomMargin: config.bottomMargin, clock: config.clock}),
		[config.iconScale, config.sideMargin, config.bottomMargin, config.clock]
	);

	// ----- actions -----
	const onActivate = useCallback((item: TileModel) => {
		if (item.key === MISC.settings) { setScreen('settings'); return; }
		if (item.key === MISC.lgHome) {
			const open = () => launchLgHome().catch(() => showToast("Couldn't open LG Home", 'error'));
			// With LG Home replaced, the real one is put back first (it comes back at the next launch of this launcher).
			if (config.replaceHome) stockHome().then(() => window.setTimeout(open, 1200));
			else open();
			return;
		}
		launchApp(item.key).catch(() => showToast(`Couldn't open ${item.label}`, 'error'));
	}, [showToast, config.replaceHome]);

	const onToggle = useCallback((tabId: string, key: string) => {
		if (tabId === TAB.apps) {
			const current = config.appIds || apps.map((a) => a.id);
			updateConfig({...config, appIds: toggleId(current, key)});
		} else {
			updateConfig({...config, sourceIds: toggleId(config.sourceIds, key)});
		}
	}, [config, apps]);

	/** Replace a row's order with `keys` (the full list of what's shown). */
	const onReorder = useCallback((tabId: string, keys: string[]) => {
		if (tabId === TAB.apps) updateConfig({...config, appIds: keys});
		else updateConfig({...config, sourceIds: keys});
	}, [config]);

	const changeOption = useCallback((optionId: string, press: Press) => {
		const pref = findPref(optionId);
		if (!pref) return;
		if (pref.kind === 'action') {
			if (optionId === 'wallpaper') setScreen('picker');
			else if (optionId === 'resetLook') { updateConfig(resetLook(config)); showToast('Look and clock reset'); }
			else if (optionId === 'replaceHome' || optionId === 'startAtBoot') {
				const refresh = () => getHookStatus().then((homeHook) => setSystemInfo((previous) => ({...previous, homeHook})));
				const running = !!(systemInfo.homeHook && systemInfo.homeHook.running);
				if (optionId === 'replaceHome' && running) {
					removeHomeHook().then(() => {
						updateConfig({...config, replaceHome: false});
						refresh();
						showToast('Turned off. LG Home opens as usual');
					});
				} else if (optionId === 'replaceHome') {
					showToast('Setting up...');
					installHomeHook(config.hookBoot).then(({result, detail}) => {
						if (result === 'applied') updateConfig({...config, replaceHome: true});
						refresh();
						showToast(hookMessage(result, detail), result === 'applied' ? 'info' : 'error');
					});
				} else if (!running && !config.replaceHome) {
					showToast('Turn on "Make this launcher the default instead of LG Home" first', 'error');
				} else {
					const wantLink = !(systemInfo.homeHook && systemInfo.homeHook.linked);
					setBootLink(wantLink).then((ok) => {
						if (ok) updateConfig({...config, hookBoot: wantLink});
						refresh();
						showToast(ok ? (wantLink ? 'The helper will start at boot' : 'Start at boot removed') : "Couldn't change that", ok ? 'info' : 'error');
					});
				}
			}
			else if (optionId === 'useAsHome') {
				const target = systemInfo.homeApp === APP_ID ? LG_HOME_ID : APP_ID;
				setHomeApp(target).then((accepted) => getHomeApp().then((homeApp) => {
					setSystemInfo((previous) => ({...previous, homeApp}));
					if (!accepted || homeApp !== target) showToast("The TV didn't accept that change", 'error');
					else showToast(target === APP_ID ? 'Home button and Back now open this launcher' : 'LG Home is the home app again');
				}));
			}
			else if (optionId === 'closeHomeNow') {
				closeHomeAndMeasure().then(({before, after}) => showToast(
					before < 0 || after < 0 ? 'LG Home closed (memory figures unavailable here)' : `LG Home closed: ${after} MB available now (was ${before} MB)`
				));
			}
			return;
		}
		const next = applyPref(config, optionId, press);
		if (next !== config) updateConfig(next);
	}, [config, showToast, systemInfo]);

	const onOption = useCallback((optionId: string) => changeOption(optionId, 'ok'), [changeOption]);
	const onAdjust = useCallback((optionId: string, direction: -1 | 1) => changeOption(optionId, direction < 0 ? 'left' : 'right'), [changeOption]);

	const onChooseWallpaper = useCallback((choice: WallpaperChoice) => {
		const keep = {intervalSec: config.wallpaper.intervalSec, shuffle: config.wallpaper.shuffle};
		const wallpaper = choice.mode === 'gradient'
			? {...DEFAULT_WALLPAPER, ...keep}
			: {mode: choice.mode, path: choice.path, ...keep};
		updateConfig({...config, wallpaper});
		setScreen('settings');
		showToast(choice.mode === 'gradient' ? 'Default background restored' : choice.mode === 'image' ? 'Loading wallpaper…' : 'Starting slideshow…');
	}, [config, showToast]);

	return (
		<>
			{!asleep && <Wallpaper config={config.wallpaper} onProblem={(text) => showToast(text, 'error')} />}
			{/* Home stays mounted under the other screens so it keeps its focus position. */}
			<Home items={homeItems} timeFormat={timeFormat} appearance={appearance} active={screen === 'home'} paused={asleep} onActivate={onActivate} />
			{/* Settings stays mounted under the picker so it keeps its tab. */}
			{screen !== 'home' && <Settings tabs={tabs} active={screen === 'settings'} onToggle={onToggle} onReorder={onReorder} onOption={onOption} onAdjust={onAdjust} onClose={() => setScreen('home')} />}
			{screen === 'picker' && <Picker onChoose={onChooseWallpaper} onClose={() => setScreen('settings')} />}
			<Toast message={toast} />
		</>
	);
}
