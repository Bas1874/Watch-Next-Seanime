/// <reference path="../goja_plugin_types/core.d.ts" />
/// <reference path="../goja_plugin_types/plugin.d.ts" />
/// <reference path="../goja_plugin_types/app.d.ts" />
/// <reference path="../goja_plugin_types/system.d.ts" />


function init() {

    $ui.register((ctx) => {
        // --- TYPE DEFINITIONS ---
        type WatchOrderAnime = {
            id: number;
            title: string;
            coverImage: string;
        };

        // --- STATES ---
        const orderedList = ctx.state<WatchOrderAnime[]>([])
        const anilistPlanned = ctx.state<WatchOrderAnime[]>([])
        const currentView = ctx.state<"main" | "add">("main")
        const isLoading = ctx.state<boolean>(false)
        const searchTerm = ctx.fieldRef<string>("") // State for the search input

        // --- STORAGE KEY ---
        const storageKey = "watchOrderList"

        // --- TRAY ---
        const tray = ctx.newTray({
            iconUrl: "https://raw.githubusercontent.com/Bas1874/Watch-Next-Seanime/refs/heads/main/src/icon/icon.png",
            withContent: true,
            width: "650px",
        })

        // --- DATA FUNCTIONS ---

        function loadListFromStorage() {
            const savedList = $storage.get<WatchOrderAnime[]>(storageKey)
            if (savedList) {
                orderedList.set(savedList)
            }
        }

        function saveListToStorage(list: WatchOrderAnime[]) {
            $storage.set(storageKey, list)
        }

        async function handleOpenAddView() {
            isLoading.set(true)
            searchTerm.setValue("") // Clear search term when opening the view
            currentView.set("add")

            try {
                const animeCollection = $anilist.getAnimeCollection(true)
                if (!animeCollection?.MediaListCollection?.lists) {
                    throw new Error("Could not fetch AniList collection.")
                }

                const planningList = animeCollection.MediaListCollection.lists.find(list => $toString(list.status) === "PLANNING")

                const currentOrderedList = orderedList.get()
                const orderedListIds = new Set(currentOrderedList.map(anime => anime.id))

                if (planningList?.entries) {
                    const availableToAdd = planningList.entries
                        .filter(entry => !!entry?.media && !orderedListIds.has(entry.media.id))
                        .map(entry => ({
                            id: entry.media!.id,
                            title: entry.media!.title?.userPreferred || "Unknown Title",
                            coverImage: entry.media!.coverImage?.large || entry.media!.coverImage?.medium || "",
                        }))
                    anilistPlanned.set(availableToAdd)
                } else {
                    anilistPlanned.set([])
                }
            }
            catch (error) {
                console.error("Error in handleOpenAddView:", error)
                ctx.toast.error("Failed to load your planned list.")
                anilistPlanned.set([])
            }
            finally {
                isLoading.set(false)
            }
        }

        // --- EVENT HANDLERS ---

        ctx.registerEventHandler("open_add_view", () => {
            handleOpenAddView()
        })

        ctx.registerEventHandler("open_main_view", () => {
            currentView.set("main")
        })

        ctx.registerEventHandler("remove_all_anime", () => {
            orderedList.set([])
            saveListToStorage([])
            ctx.toast.success("Watch order list has been cleared.")
        })

        ctx.registerEventHandler("search_term_changed", () => {
            currentView.set("add")
        })

        // --- UI LAYOUT FUNCTIONS ---

        function headerLayout(title: string, showAddButton: boolean = false) {
            // Dynamically build the list of buttons to avoid adding `null` to the items array
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
                            tray.div({
                                className: "flex gap-2",
                                items: headerButtons
                            })
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

            if (list.length === 0) {
                return tray.div({
                    items: [
                        headerLayout("My Watch Order", true),
                        tray.text("Your list is empty.", { className: "text-center text-gray-400 mt-8" }),
                        tray.text("Click 'Add Anime' to build your watch order.", { className: "text-center text-gray-400" }),
                    ],
                })
            }

            const listItems = list.map((anime, index) => {
                return tray.div({
                    className: "relative",
                    items: [
                        tray.button({
                            label: " ",
                            className: "absolute inset-0 w-full h-full z-10 bg-transparent hover:bg-white/5 border-none cursor-pointer",
                            onClick: ctx.eventHandler(`navigate_${anime.id}`, () => ctx.screen.navigateTo("/entry", { id: anime.id.toString() }))
                        }),
                        tray.div({
                            items: [
                                tray.text((index + 1).toString(), { className: "text-2xl font-bold text-gray-400 w-8 text-center" }),
                                tray.div([], {
                                    style: {
                                        backgroundImage: `url(${anime.coverImage})`,
                                        backgroundSize: "cover",
                                        backgroundPosition: "center",
                                        width: "60px",
                                        height: "84px",
                                        borderRadius: "4px",
                                    },
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

            return tray.div({ items: [headerLayout("My Watch Order", true), ...listItems] })
        }

        function addAnimeLayout() {
            if (isLoading.get()) {
                return tray.div({
                    items: [
                        headerLayout("Add from Planned", false),
                        tray.text("Loading your planned anime...", { className: "text-center text-gray-400 mt-8" }),
                    ],
                })
            }

            const plannedAnimes = anilistPlanned.get().filter(anime =>
                anime.title.toLowerCase().includes(searchTerm.current.toLowerCase())
            );

            if (plannedAnimes.length === 0) {
                return tray.div({
                    items: [
                        headerLayout("Add from Planned", false),
                        tray.input({
                            placeholder: "Search...",
                            fieldRef: searchTerm,
                            onChange: "search_term_changed"
                        }),
                        tray.text(anilistPlanned.get().length === 0
                            ? "Your AniList 'planned' list is empty or all items are already in your watch order."
                            : "No anime found with that title.",
                            { className: "text-center text-gray-400 mt-8" }
                        ),
                    ],
                })
            }

            const gridItems = plannedAnimes.map(anime => {
                return tray.div({
                    items: [
                        tray.div({
                            items: [
                                tray.div([],
                                    {
                                        style: {
                                            backgroundImage: `url(${anime.coverImage})`,
                                            backgroundSize: "contain",
                                            backgroundPosition: "center",
                                            backgroundRepeat: "no-repeat",
                                            width: "100%",
                                            minHeight: "150px",
                                        }, className: "relative opacity-50",
                                    }),
                                tray.button({
                                    label: "Add",
                                    className: "absolute inset-0 w-full h-full bg-transparent hover:bg-gray-500 z-10 transition-colors duration-300",
                                    onClick: ctx.eventHandler(`add_anime_${anime.id}`, () => {
                                        const newList = [...orderedList.get(), anime]
                                        orderedList.set(newList)
                                        saveListToStorage(newList)
                                        anilistPlanned.set(anilistPlanned.get().filter(a => a.id !== anime.id))
                                        ctx.toast.success(`'${anime.title}' added.`)
                                    }),
                                    intent: "success",
                                }),
                            ],
                            className: "relative",
                        }),
                        tray.text(`${anime.title}`, { className: "text-sm font-semibold text-center line-clamp-2 break-normal mt-1" }),
                    ],
                })
            })

            return tray.div({
                items: [
                    headerLayout("Add from Planned", false),
                    tray.input({
                        placeholder: "Search...",
                        fieldRef: searchTerm,
                        onChange: "search_term_changed"
                    }),
                    tray.div({ items: gridItems, className: "grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4" }),
                ],
            })
        }

        tray.onOpen(() => {
            loadListFromStorage()
        })

        loadListFromStorage()

        tray.render(() => {
            return currentView.get() === "main" ? mainLayout() : addAnimeLayout()
        })
    })
}
