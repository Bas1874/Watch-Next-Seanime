/// <reference path="../goja_plugin_types/core.d.ts" />
/// <reference path="../goja_plugin_types/plugin.d.ts" />
/// <reference path="../goja_plugin_types/app.d.ts" />
/// <reference path="../goja_plugin_types/system.d.ts" />


function init() {
    console.log("[DEBUG] Watch-Next Plugin Initialized");

    // This hook will run whenever Seanime fetches the user's anime collection.
    // We use it to pass the latest collection data to the UI context via the store.
    $app.onGetAnimeCollection((e) => {
        if (e.animeCollection) {
            $store.set("latestAnimeCollection", $clone(e.animeCollection));
        }
        e.next();
    });

    $ui.register((ctx) => {
        console.log("[DEBUG] UI Context Registered");

        // --- TYPE DEFINITIONS ---
        type WatchOrderAnime = {
            id: number; // Media ID
            listEntryId: number; // The ID of the list entry itself, for sorting
            title: string;
            coverImage: string;
            season?: $app.AL_MediaSeason;
            seasonYear?: number;
        };

        // --- STATES ---
        const orderedList = ctx.state<WatchOrderAnime[]>([])
        const displayableAnime = ctx.state<WatchOrderAnime[]>([])
        const originalDisplayableAnime = ctx.state<WatchOrderAnime[]>([])
        const entireAnimeCollection = ctx.state<$app.AL_RawAnimeCollection | null>(null);
        const currentView = ctx.state<"main" | "add">("main")
        const isLoading = ctx.state<boolean>(false)
        const searchTerm = ctx.fieldRef<string>("")
        const showRemoveAllConfirmation = ctx.state<boolean>(false)
        const selectedYear = ctx.fieldRef<string>("all")
        const selectedSeason = ctx.fieldRef<string>("all")
        const selectedSort = ctx.fieldRef<string>("default")
        const selectedStatus = ctx.fieldRef<string>("PLANNING")
        const autoRemoveEnabled = ctx.state<boolean>(false) // State for logic
        const autoRemoveFieldRef = ctx.fieldRef<boolean>(false); // FieldRef for the UI Switch component


        // --- STORAGE KEYS ---
        const listStorageKey = "watchOrderList"
        const settingsStorageKey = "watchOrderSettings"

        // --- TRAY ---
        const tray = ctx.newTray({
            iconUrl: "https://raw.githubusercontent.com/Bas1874/Watch-Next-Seanime/refs/heads/main/src/icon/icon.png",
            withContent: true,
            width: "650px",
        })

        // --- DATA FUNCTIONS ---

        function loadDataFromStorage() {
            // Load the watch order list
            const savedList = $storage.get<WatchOrderAnime[]>(listStorageKey)
            if (savedList) {
                orderedList.set(savedList)
            }
            // Load the auto-remove setting
            const savedSettings = $storage.get<{ autoRemove: boolean }>(settingsStorageKey);
            if (savedSettings && typeof savedSettings.autoRemove === 'boolean') {
                autoRemoveEnabled.set(savedSettings.autoRemove);
                autoRemoveFieldRef.setValue(savedSettings.autoRemove); // Sync the FieldRef for the UI
            }
        }

        function saveListToStorage(list: WatchOrderAnime[]) {
            $storage.set(listStorageKey, list)
        }
        
        function updateOriginalListFromCollection(status: string) {
            const collection = entireAnimeCollection.get();
            if (!collection?.MediaListCollection?.lists) return;

            const currentOrderedList = orderedList.get();
            const orderedListIds = new Set(currentOrderedList.map(anime => anime.id));
            
            let entries: $app.AL_RawAnimeCollection_MediaListCollection_Lists_Entries[] = [];

            if (status === "ALL") {
                 entries = collection.MediaListCollection.lists.flatMap(l => l.entries || []);
            } else {
                const list = collection.MediaListCollection.lists.find(l => $toString(l.status) === status);
                entries = list?.entries || [];
            }

            const availableToAdd = entries
                .filter(entry => !!entry?.media && !orderedListIds.has(entry.media.id))
                .map(entry => ({
                    id: entry.media!.id,
                    listEntryId: entry.id,
                    title: entry.media!.title?.userPreferred || "Unknown Title",
                    coverImage: entry.media!.coverImage?.large || entry.media!.coverImage?.medium || "",
                    season: entry.media!.season,
                    seasonYear: entry.media!.seasonYear,
                }));
            
            const uniqueAvailableToAdd = Array.from(new Map(availableToAdd.map(item => [item.id, item])).values());
            originalDisplayableAnime.set(uniqueAvailableToAdd);
        }

        async function handleOpenAddView() {
            isLoading.set(true)
            searchTerm.setValue("")
            selectedYear.setValue("all")
            selectedSeason.setValue("all")
            selectedSort.setValue("default")
            selectedStatus.setValue("PLANNING");
            currentView.set("add")

            try {
                const animeCollection = await $anilist.getRawAnimeCollection(true);
                entireAnimeCollection.set(animeCollection); 
                
                updateOriginalListFromCollection("PLANNING"); 
                applyFiltersAndSort(); 

            }
            catch (error) {
                console.error("[ERROR] in handleOpenAddView:", error)
                ctx.toast.error("Failed to load your planned list.")
                originalDisplayableAnime.set([])
                displayableAnime.set([])
            }
            finally {
                isLoading.set(false)
            }
        }

        function applyFiltersAndSort() {
            let filteredList = [...originalDisplayableAnime.get()];
            const year = selectedYear.current;
            const season = selectedSeason.current;
            const sort = selectedSort.current;
            const search = searchTerm.current.toLowerCase();
            
            if (search) {
                filteredList = filteredList.filter(anime =>
                    anime.title.toLowerCase().includes(search)
                );
            }
        
            if (year && year !== 'all') {
                const yearInt = parseInt(year);
                filteredList = filteredList.filter(anime => {
                    const animeYear = anime.seasonYear ? parseInt($toString(anime.seasonYear)) : 0;
                    return animeYear === yearInt;
                });
            }
        
            if (season && season !== 'all') {
                filteredList = filteredList.filter(anime => {
                    const animeSeason = anime.season ? $toString(anime.season) : "";
                    return animeSeason === season;
                });
            }
        
            if (sort === 'added_asc') {
                filteredList.sort((a, b) => a.listEntryId - b.listEntryId);
            } else if (sort === 'added_desc') {
                filteredList.sort((a, b) => b.listEntryId - a.listEntryId);
            }
        
            displayableAnime.set(filteredList);
        }

        // --- AUTO-REMOVE LOGIC ---
        $store.watch<$app.AL_AnimeCollection>("latestAnimeCollection", (newCollection) => {
            if (!autoRemoveEnabled.get() || !newCollection?.MediaListCollection?.lists) {
                return;
            }

            const currentlyWatchingIds = new Set<number>();
            newCollection.MediaListCollection.lists.forEach(list => {
                if ($toString(list.status) === "CURRENT") {
                    list.entries?.forEach(entry => {
                        if (entry.media?.id) {
                            currentlyWatchingIds.add(entry.media.id);
                        }
                    });
                }
            });

            if (currentlyWatchingIds.size > 0) {
                const originalWatchNextList = orderedList.get();
                const updatedWatchNextList = originalWatchNextList.filter(anime => {
                    if (currentlyWatchingIds.has(anime.id)) {
                        ctx.toast.info(`'${anime.title}' removed from watch order.`);
                        return false;
                    }
                    return true;
                });

                if (updatedWatchNextList.length < originalWatchNextList.length) {
                    orderedList.set(updatedWatchNextList);
                    saveListToStorage(updatedWatchNextList);
                }
            }
        });

        // --- EVENT HANDLERS ---
        ctx.registerEventHandler("open_add_view", () => handleOpenAddView())
        ctx.registerEventHandler("open_main_view", () => currentView.set("main"))
        ctx.registerEventHandler("remove_all_anime", () => showRemoveAllConfirmation.set(true))
        ctx.registerEventHandler("confirm_remove_all", () => {
            orderedList.set([])
            saveListToStorage([])
            ctx.toast.success("Watch order list has been cleared.")
            showRemoveAllConfirmation.set(false)
        })
        ctx.registerEventHandler("cancel_remove_all", () => showRemoveAllConfirmation.set(false))
        ctx.registerEventHandler("filter_or_search_changed", () => {
            ctx.setTimeout(() => {
                updateOriginalListFromCollection(selectedStatus.current);
                applyFiltersAndSort();
            }, 50);
        });


        // --- UI LAYOUT FUNCTIONS ---
        function removeAllConfirmationLayout() {
            return tray.div({
                // ** THE FIX **
                // Changed `absolute` to `fixed` to position relative to the viewport.
                className: "fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-50 p-4",
                items: [
                    tray.div({
                        className: "bg-gray-800 p-6 rounded-lg shadow-xl text-center",
                        items: [
                            tray.text("Are you sure?", { className: "text-xl font-bold mb-2" }),
                            tray.text("This will permanently delete your entire watch order list.", { className: "mb-6" }),
                            tray.div({
                                className: "flex gap-4 justify-center",
                                items: [
                                    tray.button({ label: "Cancel", intent: "gray-subtle", onClick: "cancel_remove_all" }),
                                    tray.button({ label: "Yes, Remove All", intent: "alert", onClick: "confirm_remove_all" })
                                ]
                            })
                        ]
                    })
                ]
            })
        }

        function headerLayout(title: string, showAddButton: boolean = false) {
            const headerButtons = [];
            if (showAddButton && orderedList.get().length > 0) {
                headerButtons.push(
                    tray.button({ label: "Remove All", intent: "alert-subtle", onClick: "remove_all_anime", size: "sm" })
                );
            }
            if (showAddButton) {
                headerButtons.push(
                    tray.button({ label: "Add Anime", intent: "primary", onClick: "open_add_view", size: "sm" })
                );
            } else {
                headerButtons.push(
                    tray.button({ label: "Back to List", intent: "primary-subtle", onClick: "open_main_view", size: "sm" })
                );
            }
            return tray.div({
                items: [
                    tray.div({
                        items: [
                            tray.text(title, { className: "font-bold text-lg" }),
                            tray.div({ className: "flex gap-2", items: headerButtons })
                        ],
                        className: "flex flex-row justify-between items-center",
                    }),
                    tray.div([], { className: "w-full border-b border-2 self-center rounded mt-2 mb-4" }),
                ],
                className: "flex flex-col",
            })
        }

        function mainLayout() {
            const list = orderedList.get()
            const showConfirmation = showRemoveAllConfirmation.get()
            let content;
        
            if (list.length === 0) {
                content = tray.div({
                    items: [
                        tray.text("Your list is empty.", { className: "text-center text-gray-400 mt-8" }),
                        tray.text("Click 'Add Anime' to build your watch order.", { className: "text-center text-gray-400" }),
                    ],
                })
            } else {
                const listItems = list.map((anime, index) => {
                    return tray.div({
                        className: "relative group",
                        items: [
                            tray.button({
                                label: " ",
                                className: "absolute inset-0 w-full h-full z-10 bg-transparent hover:bg-white/5 border-none cursor-pointer",
                                onClick: ctx.eventHandler(`navigate_${anime.id}`, () => ctx.screen.navigateTo("/entry", { id: anime.id.toString() }))
                            }),
                            tray.div({
                                items: [
                                    tray.text((index + 1).toString(), { className: "text-2xl font-bold text-gray-400 w-8 text-center" }),
                                    tray.div({
                                        className: "overflow-hidden rounded-md",
                                        style: { width: "60px", height: "84px" },
                                        items: [
                                            tray.div([], {
                                                style: {
                                                    backgroundImage: `url(${anime.coverImage})`,
                                                    backgroundSize: "cover",
                                                    backgroundPosition: "center",
                                                    width: "60px",
                                                    height: "84px",
                                                },
                                                className: "transition-transform duration-300 group-hover:scale-110"
                                            }),
                                        ]
                                    }),
                                    tray.text(`${anime.title}`, { className: "flex-grow font-semibold" }),
                                    tray.div({
                                        items: [
                                            tray.button({
                                                label: "⬆️",
                                                onClick: ctx.eventHandler(`move_up_${index}`, () => {
                                                    if (index > 0) {
                                                        const newList = [...orderedList.get()];
                                                        [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]]
                                                        orderedList.set(newList)
                                                        saveListToStorage(newList)
                                                    }
                                                }),
                                                intent: "gray-subtle", size: "sm", disabled: index === 0
                                            }),
                                            tray.button({
                                                label: "⬇️",
                                                onClick: ctx.eventHandler(`move_down_${index}`, () => {
                                                    if (index < orderedList.get().length - 1) {
                                                        const newList = [...orderedList.get()];
                                                        [newList[index + 1], newList[index]] = [newList[index], newList[index + 1]]
                                                        orderedList.set(newList)
                                                        saveListToStorage(newList)
                                                    }
                                                }),
                                                intent: "gray-subtle", size: "sm", disabled: index === list.length - 1,
                                            }),
                                            tray.button({
                                                label: "❌",
                                                onClick: ctx.eventHandler(`remove_${anime.id}`, () => {
                                                    const newList = orderedList.get().filter(a => a.id !== anime.id)
                                                    orderedList.set(newList)
                                                    saveListToStorage(newList)
                                                }),
                                                intent: "alert-subtle", size: "sm"
                                            }),
                                        ],
                                        className: "flex flex-col gap-1 relative z-20",
                                    }),
                                ],
                                className: "flex items-center gap-4 p-2 border-b border-gray-700",
                            }),
                        ]
                    })
                })
                content = tray.div({ items: listItems })
            }
        
            return tray.div({
                className: "relative",
                items: [
                    headerLayout("My Watch Order", true),
                    content,
                    tray.div([], { className: "mt-4 border-t border-gray-700" }),
                    tray.switch({
                        label: "Auto-remove when watching",
                        fieldRef: autoRemoveFieldRef, 
                        className: "mt-4",
                        onChange: ctx.eventHandler("toggle_auto_remove", (value) => {
                            autoRemoveEnabled.set(value); 
                            $storage.set(settingsStorageKey, { autoRemove: value });
                            ctx.toast.info(`Auto-remove is now ${value ? 'enabled' : 'disabled'}.`);
                        })
                    }),
                    showConfirmation ? removeAllConfirmationLayout() : null
                ].filter(Boolean)
            })
        }

        function addAnimeLayout() {
            if (isLoading.get()) {
                return tray.div({ items: [headerLayout("Add Anime", false), tray.text("Loading...", { className: "text-center text-gray-400 mt-8" })] })
            }

            const animeToDisplay = displayableAnime.get();

            const currentYear = new Date().getFullYear();
            const yearOptions = [{ label: "All Years", value: "all" }];
            for (let i = currentYear + 2; i >= 2000; i--) { yearOptions.push({ label: i.toString(), value: i.toString() }) }

            const seasonOptions = [{ label: "All Seasons", value: "all" }, { label: "Winter", value: "WINTER" }, { label: "Spring", value: "SPRING" }, { label: "Summer", value: "SUMMER" }, { label: "Fall", value: "FALL" }];
            const statusOptions = [{ label: "All Lists", value: "ALL" }, { label: "Planning", value: "PLANNING" }, { label: "Completed", value: "COMPLETED" }, { label: "Current", value: "CURRENT" }, { label: "Paused", value: "PAUSED" }, { label: "Dropped", value: "DROPPED" }];
            const sortOptions = [{ label: "Default", value: "default" }, { label: "Time Added (Newest)", value: "added_desc" }, { label: "Time Added (Oldest)", value: "added_asc" }];

            let content;
            if (animeToDisplay.length === 0) {
                content = tray.text(originalDisplayableAnime.get().length === 0 ? `Your AniList '${selectedStatus.current}' list is empty or all items are already in your watch order.` : "No anime found with the selected filters.", { className: "text-center text-gray-400 mt-8" });
            } else {
                const gridItems = animeToDisplay.map(anime => {
                    return tray.div({
                        items: [
                            tray.div({
                                className: "group relative overflow-hidden rounded-md",
                                items: [
                                    tray.div([], {
                                        style: {
                                            backgroundImage: `url(${anime.coverImage})`,
                                            backgroundSize: "cover",
                                            backgroundPosition: "center",
                                            width: "100%",
                                            minHeight: "150px",
                                        },
                                        className: "transition-transform duration-300 group-hover:scale-110"
                                    }),
                                    tray.div({
                                        className: "absolute inset-0",
                                        items: [
                                            tray.button({
                                                label: "Add",
                                                className: "absolute inset-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300",
                                                onClick: ctx.eventHandler(`add_anime_${anime.id}`, () => {
                                                    const newList = [...orderedList.get(), anime];
                                                    orderedList.set(newList);
                                                    saveListToStorage(newList);
                                                    displayableAnime.set(displayableAnime.get().filter(a => a.id !== anime.id));
                                                    originalDisplayableAnime.set(originalDisplayableAnime.get().filter(a => a.id !== anime.id));
                                                    ctx.toast.success(`'${anime.title}' added.`);
                                                }),
                                                intent: "success-subtle",
                                            }),
                                        ]
                                    })
                                ]
                            }),
                            tray.text(`${anime.title}`, { className: "text-sm font-semibold text-center line-clamp-2 break-normal mt-1" }),
                        ],
                    })
                });
                content = tray.div({ items: gridItems, className: "grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4" });
            }

            return tray.div({
                items: [
                    headerLayout("Add Anime", false),
                    tray.input({ placeholder: "Search...", fieldRef: searchTerm, onChange: "filter_or_search_changed" }),
                    tray.div({
                        className: "grid grid-cols-4 gap-2 mt-2",
                        items: [
                            tray.select({ label: "List", options: statusOptions, fieldRef: selectedStatus, onChange: "filter_or_search_changed" }),
                            tray.select({ label: "Sort", options: sortOptions, fieldRef: selectedSort, onChange: "filter_or_search_changed" }),
                            tray.select({ label: "Year", options: yearOptions, fieldRef: selectedYear, onChange: "filter_or_search_changed" }),
                            tray.select({ label: "Season", options: seasonOptions, fieldRef: selectedSeason, onChange: "filter_or_search_changed" }),
                        ]
                    }),
                    content,
                ],
            })
        }

        tray.onOpen(() => {
            loadDataFromStorage()
        })

        loadDataFromStorage()

        tray.render(() => {
            return currentView.get() === "main" ? mainLayout() : addAnimeLayout()
        })
    })
}
