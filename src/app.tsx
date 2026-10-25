import {useCallback, useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {Home, type Appearance} from './screens/Home';
import {Settings, type SettingsTab} from './screens/Settings';
import {Picker, type WallpaperChoice} from './screens/Picker';
import {CityPicker} from './screens/CityPicker';
import {Toast, type ToastMessage} from './components/Toast';
import {Wallpaper} from './components/Wallpaper';
import type {TileModel} from './components/Tile';
import {cacheApps, cachedApps, listApps, probeRoot, type AppEntry} from './lib/apps';
import {failureText, lastFailureDetail, rootState, whySuffix} from './lib/failure';
import {keepKnownIcons, sameApps} from './lib/appcache';
import type {TimeFormat} from './lib/clock';
import {listInputs, MOCK_INPUTS, type InputSource} from './lib/inputs';
import {launchApp, launchLgHome, launchSystemSettings} from './lib/launch';
import {isWebOS} from './lib/luna';
import {hidePointerOnForeground} from './lib/pointer';
import {getLogo, setLogo, closeHomeAndMeasure, closeLgHome, getHomeApp, LG_HOME_ID, setHomeApp} from './lib/system';
import {applyHomeHook, getHookStatus, hookMessage, installHomeHook, logLine, markAliveSoon, reapplyHomeHook, removeHomeHook, setBootLink, stockHome} from './lib/homehook';
import {applyPref, disabledReason, findPref, optionsFor, resetLook, type Press, type SystemInfo} from './lib/prefs';
import {loadConfig, saveConfig, toggleId, DEFAULT_WALLPAPER, type UserConfig} from './lib/storage';
import {applyTheme} from './theme/tokens';
import {useTimeFormat} from './hooks/useTimeFormat';
import {AppMenu} from './components/AppMenu';
import {hiddenAfterUpgrade, toggleHidden, visibleApps} from './lib/apporder';
import {addTvInput, removeTvInput, TV_INPUT_LOG} from './lib/tvinput';
import {uninstallApp, uninstallVerdict, UNINSTALL_LOG} from './lib/uninstall';
import {appTile, inputTile, pickInOrder} from './lib/tiles';
import {moveKey, movesFor, orderTiles, orderUpdate, reslot, type MoveAction} from './lib/tileorder';
import {APP_ID, TIMING, WALLPAPER} from './config/constants';
import {WEATHER_ENABLED} from './config/features';
import {fetchWeather} from './lib/weathernet';
import {FRESH_MS, isFresh, readWeatherCache, usableCached, weatherView, writeWeatherCache, type City, type WeatherData} from './lib/weather';

type Screen = 'home' | 'settings' | 'picker' | 'cities';

const TAB = {apps: 'apps', sources: 'sources', look: 'look', clock: 'clock', weather: 'weather', wallpaper: 'wallpaper', options: 'options'} as const;
const MISC = {lgHome: 'lg-home', settings: 'settings', system: 'system-settings'} as const;

/** The three tiles that always end the row. */
const MISC_TILES: TileModel[] = [
	{key: MISC.lgHome, label: 'LG Home', glyph: 'house'},
	{key: MISC.system, label: 'System Settings', glyph: 'tv'},
	{key: MISC.settings, label: 'Init Settings', glyph: 'gear'}
];

export function App () {
	const [screen, setScreen] = useState<Screen>('home');
	const [config, setConfig] = useState<UserConfig>(loadConfig);
	const [apps, setApps] = useState<AppEntry[]>(cachedApps);      // last known list: the row is drawn at once
	const [asleep, setAsleep] = useState(document.hidden);
	const [wakes, setWakes] = useState(0);                    // counts each return to the front (Home pressed)
	const [wallpaperOn, setWallpaperOn] = useState(!document.hidden);
	const wasHidden = useRef(document.hidden);
	const [menu, setMenu] = useState<{key: string; title: string; app: AppEntry | null} | null>(null);   // the tile whose Move / Hide / Uninstall menu is open
	const [focus, setFocus] = useState<{key: string; seq: number} | undefined>(undefined);               // asks Home to follow a moved tile
	const replaceRef = useRef(config.replaceHome);
	const [allInputs, setInputs] = useState<InputSource[]>([]);
	// the launcher itself may be in the TV's input list (see Options): it is not offered as a source
	const inputs = useMemo(() => allInputs.filter((i) => i.appId !== APP_ID), [allInputs]);
	const tvInput: boolean | null = allInputs.length === 0 ? null : allInputs.some((i) => i.appId === APP_ID);
	const [weather, setWeather] = useState<WeatherData | null>(() => (WEATHER_ENABLED ? readWeatherCache() : null));
	const weatherRef = useRef(weather);
	weatherRef.current = weather;
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
			markAliveSoon(began ? `launcher: first screen ${Date.now() - began} ms after the page started (hidden: ${document.hidden})` : undefined);
		}));
		return () => window.cancelAnimationFrame(frame);
	}, []);

	// Just after the TV starts the background helper may not be running yet (it is only started at boot when the
	// "at boot" link is on), and until it is, the Home button shows LG Home for a moment. So right after the first
	// screen is up, one light call makes sure it is running, tried again a few times if the Homebrew service is not
	// up yet. (The heavier check, which can rewrite the helper's files, still waits as before.)
	useEffect(() => {
		if (!config.replaceHome || !isWebOS()) return undefined;
		const delays = [1200, 3000, 6000, 12000, 25000, 50000];
		let cancelled = false;
		let timer = 0;
		const attempt = (n: number) => applyHomeHook().then((result) => {
			if (cancelled || result !== 'failed' || n + 1 >= delays.length) return;
			timer = window.setTimeout(() => attempt(n + 1), delays[n + 1]);
		});
		timer = window.setTimeout(() => attempt(0), delays[0]);
		return () => { cancelled = true; window.clearTimeout(timer); };
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

	// Load apps at start and whenever the Homebrew option changes. With a saved list on screen the real one is
	// fetched a few seconds later, off the critical path. It is fetched again each time the launcher comes back to
	// the front (at most every 10 s), so a newly installed app shows up without restarting the launcher.
	//
	// The saved list is the full Homebrew list (with its icons), and it is only ever replaced by a newer full list.
	// Just after the TV starts the Homebrew service is often not up yet: the saved list then stays on screen, and
	// the read is tried again a little later, quietly. The small built-in catalogue is used only when there is no
	// saved list at all (the very first start).
	const hadCache = useRef(apps.length > 0);
	const haveFull = useRef(apps.length > 0);           // the list on screen is a full Homebrew list
	const appsRef = useRef(apps);
	appsRef.current = apps;
	const lastLoad = useRef(0);
	const seenWakes = useRef(0);
	const [reloads, setReloads] = useState(0);        // the "Refresh list" button in Settings → Apps
	const manualLoad = useRef(false);
	useEffect(() => {
		const woke = wakes !== seenWakes.current;
		seenWakes.current = wakes;
		const manual = manualLoad.current;               // asked for with the button: now, and say what happened
		manualLoad.current = false;
		if (woke && !manual && Date.now() - lastLoad.current < 10000) return undefined;
		let cancelled = false;
		let timer = 0;
		const retryAfter = [15000, 45000, 120000, 300000];      // quiet retries when the Homebrew service does not answer
		let told = false;
		const load = (attempt: number) => {
			if (cancelled) return;
			const keepSaved = config.useHomebrew && haveFull.current;
			const retry = () => { if (!cancelled && config.useHomebrew && attempt < retryAfter.length) timer = window.setTimeout(() => { if (document.hidden) return; load(attempt + 1); }, retryAfter[attempt]); };
			listApps(config.useHomebrew, keepSaved)
				.then(({apps: fresh, source}) => {
					if (cancelled) return;
					if (source === 'homebrew') {
						const list = keepKnownIcons(fresh, appsRef.current);
						if (manual) {
							const added = list.filter((a) => !appsRef.current.some((p) => p.id === a.id)).length;
							showToast(added > 0 ? `${added} new ${added === 1 ? 'app' : 'apps'} found` : 'The app list is up to date');
						}
						lastLoad.current = Date.now();       // counted only once a full list has been read, so a failed load is tried again
						haveFull.current = true;
						setApps((previous) => (sameApps(previous, list) ? previous : list));
						cacheApps(list);
						// settings from an older version listed the apps to show: now the real list is known, keep those apps hidden
						if (list.length > 0) setConfig((c) => { if (c.hiddenIds !== null) return c; const next = {...c, hiddenIds: hiddenAfterUpgrade(list, c.appIds)}; saveConfig(next); return next; });
						return;
					}
					// only the built-in catalogue was available (nothing saved yet, or Homebrew is switched off)
					setApps((previous) => (sameApps(previous, fresh) ? previous : fresh));
					if (config.useHomebrew) {
						lastLoad.current = 0;
						if ((manual || !told) && rootState() !== 'no') { told = true; showToast(`Using the built-in app list${whySuffix() || '. The Homebrew Channel is not available yet'}`, 'error'); }
						retry();
					} else {
						lastLoad.current = Date.now();
						if (manual) showToast('The live app list is switched off. Turn it on in Settings → Options to see new apps', 'error');
					}
				})
				.catch(() => {
					if (cancelled) return;
					// the saved full list stays on screen; try again later without a word
					if (config.useHomebrew && haveFull.current) retry();
					else if (manual || !told) { told = true; showToast(`Could not read the app list${whySuffix()}`, 'error'); }
				});
		};
		// Not needed to draw the home screen, and it is a lot of work for the TV (a shell command and the icons), so
		// it waits until the launcher has been up for a few seconds (at once only when there is no saved list to show).
		timer = window.setTimeout(() => { if (woke && document.hidden) return; load(0); }, hadCache.current || woke ? TIMING.backgroundWorkMs : 0);
		hadCache.current = false;
		return () => { cancelled = true; window.clearTimeout(timer); };
	}, [config.useHomebrew, wakes, reloads, showToast]);

	// In the background the launcher lets go of its wallpaper (the big bitmap) and stops its clock, but it
	// keeps its screen: if the TV ever reports "hidden" wrongly, the launcher must still be visible,
	// not a black screen. The state is also re-read every second as a safety net.
	replaceRef.current = config.replaceHome;
	useEffect(() => {
		const sync = (why: string) => {
			const hidden = document.hidden;
			if (wasHidden.current && !hidden) setWakes((n) => n + 1);
			wasHidden.current = hidden;
			setAsleep((was) => {
				if (was !== hidden && replaceRef.current) {
					// the helper checks for the "alive" mark after opening the launcher
					if (hidden) logLine(`launcher: hidden (${why})`);
					else markAliveSoon(`launcher: visible (${why})`);
				}
				return hidden;
			});
			if (hidden) { setScreen('home'); setMenu(null); }
		};
		const onVisibility = () => sync('event');
		document.addEventListener('visibilitychange', onVisibility);
		const poll = window.setInterval(() => sync('check'), 1000);
		// Home pressed while the launcher is already in front: the TV relaunches it without hiding it first.
		const onRelaunch = () => {
			setScreen('home'); setMenu(null); setWakes((n) => n + 1);
			// Home pressed while in front: the launcher never became hidden, so tell the helper it is here
			// (otherwise its check could think the launcher failed to show and open it again and again)
			if (replaceRef.current) markAliveSoon('launcher: relaunched while in front');
		};
		document.addEventListener('webOSRelaunch', onRelaunch);
		return () => { document.removeEventListener('visibilitychange', onVisibility); document.removeEventListener('webOSRelaunch', onRelaunch); window.clearInterval(poll); };
	}, []);

	// The wallpaper stays loaded for a while after the launcher goes to the background, so pressing Home
	// again finds it ready (no fade-in). After that it is released to give the memory back.
	useEffect(() => {
		if (!asleep) { setWallpaperOn(true); return undefined; }
		const timer = window.setTimeout(() => setWallpaperOn(false), WALLPAPER.releaseAfterMs);
		return () => window.clearTimeout(timer);
	}, [asleep]);

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
		// note the real size of the screen in the helper's log: this is what to look at if a list ever looks wrong on some TV
		if (screen === 'settings' && isWebOS()) {
			const chrome = /Chrome\/([0-9.]+)/.exec(navigator.userAgent);
			logLine(`launcher: settings opened, window ${window.innerWidth}x${window.innerHeight}, pixel ratio ${window.devicePixelRatio}, screen ${window.screen.width}x${window.screen.height}, web view ${chrome ? chrome[1] : 'unknown'}`);
		}
		// One tiny command first: can this TV run commands at all? If not, the rows that need that are greyed out
		// with the reason, and the other status reads (which would only fail) are skipped.
		if (screen === 'settings') {
			let live = true;
			probeRoot().then((root) => {
				const rootDetail = lastFailureDetail();
				if (!live) return undefined;
				if (root === 'no') { setSystemInfo({homeApp: null, homeHook: null, logo: null, root, rootDetail}); return undefined; }
				return Promise.all([getHomeApp(), getHookStatus(), getLogo()]).then(([homeApp, homeHook, logo]) => { if (live) setSystemInfo({homeApp, homeHook, logo, root, rootDetail}); });
			});
			return () => { live = false; };
		}
		return undefined;
	}, [screen]);

	// Shortly after we come to the front (not at the very first moment, while the TV is still switching
	// apps): make sure the hand-over helper is running (if it is switched on), and end LG's home app to
	// free memory. If we are pushed to the back again within seconds, LG Home has come back in front of
	// us, so "Close LG Home" turns itself off (not needed when the helper is on: it hands straight back).
	useEffect(() => {
		if ((!config.closeHome && !config.replaceHome) || !isWebOS()) return undefined;
		let timer = 0;
		let retryTimer = 0;
		const arm = () => {
			window.clearTimeout(timer);
			window.clearTimeout(retryTimer);
			if (document.hidden) return;
			timer = window.setTimeout(() => {
				closedAt.current = Date.now();
				if (config.replaceHome) {
					// The Homebrew service is often not up yet just after the TV starts: then nothing is changed
					// (the setting stays on) and it is tried again a little later.
					const tryHelper = (attempt: number) => reapplyHomeHook(config.hookBoot).then(({result, detail, fatal, unreachable}) => {
						if (unreachable) {
							if (attempt < 4) retryTimer = window.setTimeout(() => { if (!document.hidden) tryHelper(attempt + 1); }, [10000, 30000, 90000, 240000][attempt]);
							return;
						}
						if (!fatal) return;
						setConfig((c) => { const next = {...c, replaceHome: false}; saveConfig(next); return next; });
						removeHomeHook();
						showToast(hookMessage(result, detail), 'error');
					});
					tryHelper(0);
				}
				closeLgHome().catch(() => undefined);      // the Homebrew service may not be up yet: nothing to do then
			}, TIMING.backgroundWorkMs);
		};
		const onVisibility = () => {
			if (!config.replaceHome && document.hidden && Date.now() - closedAt.current < 2500) {
				setConfig((c) => { const next = {...c, closeHome: false}; saveConfig(next); return next; });
				try { localStorage.setItem('initlauncher-homekill-off', '1'); } catch { /* ignore */ }
			}
			arm();
		};
		arm();
		document.addEventListener('visibilitychange', onVisibility);
		return () => { window.clearTimeout(timer); window.clearTimeout(retryTimer); document.removeEventListener('visibilitychange', onVisibility); };
	}, [config.closeHome, config.replaceHome, config.hookBoot, showToast]);

	// The weather line: read from the saved copy at once (nothing is fetched to draw the home screen), refreshed in
	// the background a few seconds after the launcher appears, and then every 30 minutes while it is in front.
	const wx = config.weather;
	const wxCity: City | null = WEATHER_ENABLED && wx.on ? wx.city : null;
	const wxLat = wxCity ? wxCity.lat : 0;
	const wxLon = wxCity ? wxCity.lon : 0;
	useEffect(() => {
		if (!wxCity) return undefined;
		const city = wxCity;
		const allowShell = config.useHomebrew && isWebOS();
		const backoff = [120000, 600000, 1800000];
		let cancelled = false;
		let timer = 0;
		let failures = 0;
		const run = () => {
			if (cancelled || document.hidden) return;        // coming back to the front starts this over
			fetchWeather(city, allowShell).then(
				(data) => {
					if (cancelled) return;
					failures = 0;
					writeWeatherCache(data);
					setWeather(data);
					timer = window.setTimeout(run, FRESH_MS);
				},
				() => {
					if (cancelled) return;
					if (failures === 0 && !usableCached(weatherRef.current, city.lat, city.lon, Date.now())) showToast("Couldn't get the weather yet. Check the TV's internet connection. It will try again", 'error');
					timer = window.setTimeout(run, backoff[Math.min(failures, backoff.length - 1)]);
					failures++;
				}
			);
		};
		const now = Date.now();
		const known = weatherRef.current;
		const wait = isFresh(known, city.lat, city.lon, now) && known
			? Math.max(0, FRESH_MS - (now - known.at))
			: (usableCached(known, city.lat, city.lon, now) ? TIMING.backgroundWorkMs : 1500);
		timer = window.setTimeout(run, wait);
		return () => { cancelled = true; window.clearTimeout(timer); };
	}, [wxCity !== null, wxLat, wxLon, wakes, config.useHomebrew, showToast]);

	const weatherLine = useMemo(() => {
		if (!wxCity) return null;
		const data = usableCached(weather, wxCity.lat, wxCity.lon, Date.now());
		return data ? weatherView(data, wx.unit, wx.showRange, wx.showCity ? wxCity.name : '') : null;
	}, [weather, wxCity, wx.unit, wx.showRange, wx.showCity]);

	// Tell the user once if the safety switch-off fired.
	useEffect(() => {
		const onVisibility = () => {
			if (document.hidden) return;
			try {
				if (localStorage.getItem('initlauncher-homekill-off')) {
					localStorage.removeItem('initlauncher-homekill-off');
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
		() => visibleApps(apps, config.appIds, config.hiddenIds),
		[apps, config.appIds, config.hiddenIds]
	);
	const shownInputs = useMemo(() => pickInOrder(inputs, config.sourceIds, (s) => s.appId), [inputs, config.sourceIds]);

	// apps and inputs share one order (Move to start / left / right / end); LG Home and Settings always end the row
	const orderedTiles: TileModel[] = useMemo(
		() => orderTiles(shownApps.map(appTile).concat(shownInputs.map(inputTile)), (t) => t.key, config.tileOrder),
		[shownApps, shownInputs, config.tileOrder]
	);
	const homeItems: TileModel[] = useMemo(() => orderedTiles.concat(MISC_TILES), [orderedTiles]);

	const timeFormat: TimeFormat = config.clockFormat === 'tv' ? tvFormat : config.clockFormat;

	const tabs: SettingsTab[] = useMemo(() => [
		{id: TAB.apps, label: 'Apps', noun: 'apps', refresh: true, items: apps.map(appTile), shown: shownApps.map(appTile)},
		{id: TAB.sources, label: 'Sources', noun: 'sources', items: inputs.map(inputTile), shown: shownInputs.map(inputTile)},
		{id: TAB.look, label: 'Look', noun: '', items: [], shown: [], options: optionsFor('look', config)},
		{id: TAB.clock, label: 'Clock', noun: '', items: [], shown: [], options: optionsFor('clock', config)},
		...(WEATHER_ENABLED ? [{id: TAB.weather, label: 'Weather', noun: '', items: [], shown: [], options: optionsFor('weather', config)}] : []),
		{id: TAB.wallpaper, label: 'Wallpaper', noun: '', items: [], shown: [], options: optionsFor('wallpaper', config)},
		{id: TAB.options, label: 'Options', noun: '', items: [], shown: [], options: optionsFor('options', config, {...systemInfo, tvInput})}
	], [apps, inputs, shownApps, shownInputs, config, systemInfo, tvInput]);

	const appearance: Appearance = useMemo(
		() => ({iconScale: config.iconScale, sideMargin: config.sideMargin, bottomMargin: config.bottomMargin, showLabels: config.showLabels, rows: config.rows, clock: config.clock}),
		[config.iconScale, config.sideMargin, config.bottomMargin, config.showLabels, config.rows, config.clock]
	);

	// ----- actions -----
	const onActivate = useCallback((item: TileModel) => {
		if (item.key === MISC.settings) { setScreen('settings'); return; }
		if (item.key === MISC.system) { launchSystemSettings().catch(() => showToast("Couldn't open the TV's settings", 'error')); return; }
		if (item.key === MISC.lgHome) {
			const open = () => launchLgHome().catch(() => showToast("Couldn't open LG Home", 'error'));
			// With LG Home replaced, the real one is put back first (it comes back at the next launch of this launcher).
			if (config.replaceHome) stockHome().then(() => window.setTimeout(open, 1200));
			else open();
			return;
		}
		// With the helper on: say the launcher is alive and note what is being opened, so the helper's check
		// can never mistake this moment for a failure, and its log shows what happened if an app does not open.
		if (config.replaceHome) markAliveSoon(`launcher: opening ${item.key}`, false);
		launchApp(item.key).catch(() => {
			if (config.replaceHome) logLine(`launcher: the TV refused to open ${item.key}`);
			showToast(`Couldn't open ${item.label}`, 'error');
		});
	}, [showToast, config.replaceHome]);

	const onToggle = useCallback((tabId: string, key: string) => {
		if (tabId === TAB.apps) {
			// apps are shown unless hidden: OK adds the app to the hide-list, or takes it off
			const hidden = config.hiddenIds !== null ? config.hiddenIds : hiddenAfterUpgrade(apps, config.appIds);
			updateConfig({...config, hiddenIds: toggleHidden(hidden, key)});
		} else {
			updateConfig({...config, sourceIds: toggleId(config.sourceIds, key)});
		}
	}, [config, apps]);

	/** Replace a row's order with `keys` (the full list of what's shown). */
	const onReorder = useCallback((tabId: string, keys: string[]) => {
		// the tiles of this tab take the places they already hold on the shared row, in their new order
		const whole = reslot(orderedTiles.map((t) => t.key), keys);
		const update = orderUpdate(whole, shownApps.map((a) => a.id), shownInputs.map((i) => i.appId), config.appIds, config.sourceIds);
		const hiddenIds = config.hiddenIds !== null ? config.hiddenIds : hiddenAfterUpgrade(apps, config.appIds);
		updateConfig({...config, tileOrder: update.tileOrder, hiddenIds, appIds: tabId === TAB.apps ? keys.concat((config.appIds || []).filter((id) => keys.indexOf(id) === -1)) : update.appIds, sourceIds: tabId === TAB.sources ? keys : update.sourceIds});
	}, [config, apps, orderedTiles, shownApps, shownInputs]);

	const changeOption = useCallback((optionId: string, press: Press) => {
		const pref = findPref(optionId);
		if (!pref) return;
		const blocked = disabledReason(optionId, systemInfo);
		if (blocked) { showToast(blocked, 'error'); return; }
		if (optionId === 'weatherOn' && !config.weather.city) { showToast('Choose a city first'); setScreen('cities'); return; }
		if (pref.kind === 'action') {
			if (optionId === 'wallpaper') setScreen('picker');
			else if (optionId === 'weatherCity') setScreen('cities');
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
						showToast(ok ? (wantLink ? 'The helper will start at boot' : 'Start at boot removed') : `Couldn't change that${whySuffix() || '. The TV did not accept the command'}`, ok ? 'info' : 'error');
					});
				}
			}
			else if (optionId === 'useAsHome') {
				const target = systemInfo.homeApp === APP_ID ? LG_HOME_ID : APP_ID;
				setHomeApp(target).then((accepted) => getHomeApp().then((homeApp) => {
					setSystemInfo((previous) => ({...previous, homeApp}));
					if (!accepted || homeApp !== target) showToast(`The TV didn't accept that change${whySuffix()}`, 'error');
					else showToast(target === APP_ID ? 'Home button and Back now open this launcher' : 'LG Home is the home app again');
				}));
			}
			else if (optionId === 'tvInput') {
				const adding = tvInput !== true;
				showToast(adding ? 'Adding the launcher as an input…' : 'Removing the launcher from the inputs…');
				(adding ? addTvInput() : removeTvInput())
					.then((accepted) => (isWebOS() ? listInputs() : Promise.resolve(MOCK_INPUTS)).then((list) => {
						setInputs(list);
						const listed = list.some((i) => i.appId === APP_ID);
						if (listed === adding) showToast(adding ? 'Added. Now set the TV to start on its last input, and pick this one' : 'Removed from the TV\'s inputs');
						else showToast(accepted ? "The TV accepted that but doesn't show the change yet. Check the TV's input list" : `The TV didn't accept that (details: ${TV_INPUT_LOG})`, 'error');
					}))
					.catch((error) => showToast(failureText(error, 'change the TV input'), 'error'));
			}
			else if (optionId === 'lgLogo') {
				const wantOn = systemInfo.logo !== 'on';
				showToast('Changing…');
				setLogo(wantOn).then((ok) => getLogo().then((logo) => {
					setSystemInfo((previous) => ({...previous, logo}));
					showToast(ok ? (wantOn ? 'The LG logo will show when the TV starts' : 'The LG logo is turned off for the next start') : `The TV didn't accept that change${whySuffix()}`, ok ? 'info' : 'error');
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
	}, [config, showToast, systemInfo, tvInput]);

	const onRefresh = useCallback(() => {
		manualLoad.current = true;
		showToast('Checking for new apps…');
		setReloads((n) => n + 1);
	}, [showToast]);

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

	const onChooseCity = useCallback((city: City) => {
		updateConfig({...config, weather: {...config.weather, city, on: true}});
		setScreen('settings');
		showToast(`Weather set to ${city.name}`);
	}, [config, showToast]);

	// Hold OK on an app or input: its Move / Hide (/ Uninstall) menu. LG Home and Settings have no menu.
	const onLongPress = useCallback((item: TileModel) => {
		if (item.key === MISC.lgHome || item.key === MISC.settings || item.key === MISC.system) return;
		const app = apps.find((a) => a.id === item.key) || null;
		setMenu({key: item.key, title: item.label, app});
	}, [apps]);

	const hideTile = useCallback((tile: {key: string; title: string; app: AppEntry | null}) => {
		onToggle(tile.app ? TAB.apps : TAB.sources, tile.key);
		setMenu(null);
		showToast(`${tile.title} hidden. Add it back in Settings → ${tile.app ? 'Apps' : 'Sources'}`);
	}, [onToggle, showToast]);

	// Move to start / left / right on the shared row of apps and inputs; the highlight follows the tile.
	const moveTile = useCallback((key: string, action: MoveAction) => {
		const keys = orderedTiles.map((t) => t.key);
		const next = moveKey(keys, key, action);
		const update = orderUpdate(next, shownApps.map((a) => a.id), shownInputs.map((i) => i.appId), config.hiddenIds !== null ? (config.appIds || []) : null, config.sourceIds);
		updateConfig({...config, tileOrder: update.tileOrder, appIds: update.appIds !== null ? update.appIds : config.appIds, sourceIds: update.sourceIds});
		setFocus((f) => ({key, seq: (f ? f.seq : 0) + 1}));
		setMenu(null);
	}, [config, orderedTiles, shownApps, shownInputs]);

	// Uninstall (after the menu's confirmation): remove it, then re-read the app list to see whether it is really gone.
	const removeApp = useCallback((app: AppEntry) => {
		uninstallApp(app.id).then((result) => listApps(config.useHomebrew).then(
			({apps: list, source}) => { setApps(list); if (source === 'homebrew') cacheApps(list); },
			() => { if (result === 'removed') setApps((previous) => previous.filter((a) => a.id !== app.id)); }
		).then(() => {
			setMenu(null);
			if (result === 'removed') {
				updateConfig({...config, appIds: config.appIds ? config.appIds.filter((id) => id !== app.id) : null, hiddenIds: config.hiddenIds ? config.hiddenIds.filter((id) => id !== app.id) : config.hiddenIds});
				showToast(`Uninstalled ${app.title}`);
			} else {
				showToast(result === 'still-installed' ? `The TV did not uninstall ${app.title} (details: ${UNINSTALL_LOG})` : `Couldn't uninstall that app${whySuffix() || '. The TV did not accept the command'}`, 'error');
			}
		}));
	}, [config, showToast]);

	const menuVerdict = menu && menu.app ? uninstallVerdict(menu.app) : null;
	const menuBlocked = menuVerdict && !menuVerdict.ok ? menuVerdict.reason : (config.useHomebrew ? null : 'Turn on "Live app list via Homebrew Channel" in Options');
	const menuMoves = menu ? movesFor(orderedTiles.map((t) => t.key), menu.key) : {start: false, left: false, right: false, end: false};

	return (
		<>
			{wallpaperOn && <Wallpaper config={config.wallpaper} onProblem={(text) => showToast(text, 'error')} />}
			{/* Home stays mounted under the other screens so it keeps its focus position. */}
			<Home items={homeItems} timeFormat={timeFormat} appearance={appearance} active={screen === 'home' && !menu} paused={asleep} onActivate={onActivate} onLongPress={onLongPress} wake={wakes} focus={focus} weather={weatherLine} />
			{menu && <AppMenu title={menu.title} moves={menuMoves} hideDetail={menu.app ? 'You can add it back in Settings → Apps' : 'You can add it back in Settings → Sources'} showUninstall={!!menu.app} blockedReason={menuBlocked} onMove={(action) => moveTile(menu.key, action)} onHide={() => hideTile(menu)} onUninstall={() => { if (menu.app) removeApp(menu.app); }} onClose={() => setMenu(null)} />}
			{/* Settings stays mounted under the picker so it keeps its tab. */}
			{screen !== 'home' && <Settings tabs={tabs} active={screen === 'settings'} onToggle={onToggle} onReorder={onReorder} onOption={onOption} onRefresh={onRefresh} onAdjust={onAdjust} onClose={() => setScreen('home')} />}
			{screen === 'picker' && <Picker onChoose={onChooseWallpaper} onClose={() => setScreen('settings')} />}
			{WEATHER_ENABLED && screen === 'cities' && <CityPicker allowShell={config.useHomebrew && isWebOS()} onChoose={onChooseCity} onClose={() => setScreen('settings')} />}
			<Toast message={toast} />
		</>
	);
}
