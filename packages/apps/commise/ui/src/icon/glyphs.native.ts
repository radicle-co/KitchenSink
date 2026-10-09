/**
 * @module @commise/ui/icon — the native glyph table: every meaning in the Registry mapped to its `lucide-react-native`
 * glyph.
 *
 * ⛔ DEEP IMPORTS ONLY (`lucide-react-native/icons/<glyph>`). Metro does not tree-shake by default, so the package root
 * would ship every one of Lucide's glyphs in the app bundle. This is the only module on native that imports Lucide, and
 * `packages/infra/global/__tests__/iconImportBoundary.test.ts` holds it to the deep form. The web table (`glyphs.ts`)
 * must draw the same glyph for every meaning; `__tests__/glyphs.test.tsx` holds the two tables to that.
 *
 * @pattern Registry — a table keyed by the closed `IconName` union, so a meaning without a glyph does not compile
 */
import ArrowUpGlyph from 'lucide-react-native/icons/arrow-up';
import BellGlyph from 'lucide-react-native/icons/bell';
import BookOpenGlyph from 'lucide-react-native/icons/book-open';
import CalendarGlyph from 'lucide-react-native/icons/calendar';
import CameraGlyph from 'lucide-react-native/icons/camera';
import ChartColumnGlyph from 'lucide-react-native/icons/chart-column';
import CheckGlyph from 'lucide-react-native/icons/check';
import ChevronDownGlyph from 'lucide-react-native/icons/chevron-down';
import ChevronLeftGlyph from 'lucide-react-native/icons/chevron-left';
import ChevronRightGlyph from 'lucide-react-native/icons/chevron-right';
import ChevronUpGlyph from 'lucide-react-native/icons/chevron-up';
import ChevronsLeftGlyph from 'lucide-react-native/icons/chevrons-left';
import ClipboardPasteGlyph from 'lucide-react-native/icons/clipboard-paste';
import ClockGlyph from 'lucide-react-native/icons/clock';
import CompassGlyph from 'lucide-react-native/icons/compass';
import CopyPlusGlyph from 'lucide-react-native/icons/copy-plus';
import EllipsisGlyph from 'lucide-react-native/icons/ellipsis';
import EyeGlyph from 'lucide-react-native/icons/eye';
import FlameGlyph from 'lucide-react-native/icons/flame';
import GlobeGlyph from 'lucide-react-native/icons/globe';
import HouseGlyph from 'lucide-react-native/icons/house';
import ImageGlyph from 'lucide-react-native/icons/image';
import ImagePlusGlyph from 'lucide-react-native/icons/image-plus';
import InfoGlyph from 'lucide-react-native/icons/info';
import ListPlusGlyph from 'lucide-react-native/icons/list-plus';
import LockGlyph from 'lucide-react-native/icons/lock';
import LogInGlyph from 'lucide-react-native/icons/log-in';
import LogOutGlyph from 'lucide-react-native/icons/log-out';
import MenuGlyph from 'lucide-react-native/icons/menu';
import MinusGlyph from 'lucide-react-native/icons/minus';
import PencilLineGlyph from 'lucide-react-native/icons/pencil-line';
import PlusGlyph from 'lucide-react-native/icons/plus';
import RefreshCwGlyph from 'lucide-react-native/icons/refresh-cw';
import RotateCcwGlyph from 'lucide-react-native/icons/rotate-ccw';
import SaveGlyph from 'lucide-react-native/icons/save';
import SearchGlyph from 'lucide-react-native/icons/search';
import SettingsGlyph from 'lucide-react-native/icons/settings';
import ShoppingCartGlyph from 'lucide-react-native/icons/shopping-cart';
import SlidersHorizontalGlyph from 'lucide-react-native/icons/sliders-horizontal';
import StarGlyph from 'lucide-react-native/icons/star';
import SunGlyph from 'lucide-react-native/icons/sun';
import TimerGlyph from 'lucide-react-native/icons/timer';
import TrashGlyph from 'lucide-react-native/icons/trash';
import TriangleAlertGlyph from 'lucide-react-native/icons/triangle-alert';
import UserGlyph from 'lucide-react-native/icons/user';
import UserPlusGlyph from 'lucide-react-native/icons/user-plus';
import UserXGlyph from 'lucide-react-native/icons/user-x';
import UsersGlyph from 'lucide-react-native/icons/users';
import XGlyph from 'lucide-react-native/icons/x';

import type { IconName } from './props.js';

/**
 * Every deep glyph module has one type, Lucide's `LucideIcon`. It is named through a glyph rather than imported from
 * the package root, so this file holds no reference to the root at all.
 */
type NativeGlyph = typeof HouseGlyph;

/** The `lucide-react-native` glyph for each meaning. */
export const GLYPHS: Readonly<Record<IconName, NativeGlyph>> = {
    house: HouseGlyph,
    bookOpen: BookOpenGlyph,
    compass: CompassGlyph,
    plus: PlusGlyph,
    clipboardPaste: ClipboardPasteGlyph,
    ellipsis: EllipsisGlyph,
    chevronLeft: ChevronLeftGlyph,
    x: XGlyph,
    search: SearchGlyph,
    copyPlus: CopyPlusGlyph,
    trash: TrashGlyph,
    clock: ClockGlyph,
    users: UsersGlyph,
    flame: FlameGlyph,
    star: StarGlyph,
    lock: LockGlyph,
    globe: GlobeGlyph,
    pencilLine: PencilLineGlyph,
    timer: TimerGlyph,
    sun: SunGlyph,
    check: CheckGlyph,
    arrowUp: ArrowUpGlyph,
    imagePlus: ImagePlusGlyph,
    listPlus: ListPlusGlyph,
    chevronsLeft: ChevronsLeftGlyph,
    slidersHorizontal: SlidersHorizontalGlyph,
    rotateCcw: RotateCcwGlyph,
    chevronDown: ChevronDownGlyph,
    eye: EyeGlyph,
    user: UserGlyph,
    minus: MinusGlyph,
    chevronRight: ChevronRightGlyph,
    chevronUp: ChevronUpGlyph,
    refreshCw: RefreshCwGlyph,
    logIn: LogInGlyph,
    logOut: LogOutGlyph,
    userPlus: UserPlusGlyph,
    userX: UserXGlyph,
    save: SaveGlyph,
    settings: SettingsGlyph,
    camera: CameraGlyph,
    image: ImageGlyph,
    triangleAlert: TriangleAlertGlyph,
    info: InfoGlyph,
    calendar: CalendarGlyph,
    shoppingCart: ShoppingCartGlyph,
    chartColumn: ChartColumnGlyph,
    bell: BellGlyph,
    menu: MenuGlyph,
};
