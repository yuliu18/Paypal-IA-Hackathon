// AG Studio theme for the PayPal dashboard. Every value points at a design token from
// app/globals.css, the same variables the shell's Tailwind classes use, so Studio renders as
// part of the page rather than a component embedded in it: change a token there and the shell,
// widgets, grids and charts all follow.
//
// The dashboard is light like the rest of the app: white widgets with a hairline edge on the grey
// canvas, the same cards the other pages use.

import { studioTheme } from 'ag-studio';

const token = (name: string) => `var(--pp-${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

// Studio colours series by position: the first measure (or legend value) of a chart takes colour 1,
// the second colour 2 and so on, and a chart can't pick its own. So the palette starts with the
// guard's verdicts, which the guard charts plot as measures in this order: passed green, held amber,
// stopped red; blue, pink and violet follow (app/globals.css, validated for colour blindness).
const SERIES = [1, 2, 3, 4, 5, 6].map((n) => token(`series-${n}`));

const palette = Object.fromEntries(
  SERIES.map((color, i) => [
    [`chartPaletteFills${i + 1}Color`, color],
    [`chartPaletteStrokes${i + 1}Color`, color],
  ]).flat(),
);

export const agStudioPayPalTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: token('font'),
  fontSize: 14,
  textColor: token('ink'),
  foregroundColor: token('ink'),
  subtleTextColor: token('muted'),
  backgroundColor: token('surface'),
  borderColor: token('border'),
  // PayPal blue marks what you can click: selected buttons and focus rings.
  accentColor: token('blue'),
  iconColor: token('navy'),
  rowHoverColor: token('highlight'),
  browserColorScheme: 'light',
  // Menus, pickers and tooltips (the filters panel, Edit mode, chart hovers) on white.
  menuBackgroundColor: token('surface'),
  menuTextColor: token('ink'),
  menuBorder: line('border'),
  menuSeparatorColor: token('border'),
  tooltipBackgroundColor: token('surface'),
  tooltipTextColor: token('ink'),
  tooltipBorder: line('border'),

  // No frame: the canvas is the page's own grey background. Each widget is inset 12px inside its grid cell, so 20px of padding puts
  // widget edges on the header's 32px gutter.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: 'transparent',
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: 'transparent',
  studioCanvasGridLineColor: token('border'),
  studioCanvasPadding: 20,
  // Taller rows than the default 16px make room for roomy cards.
  studioCanvasRowHeight: 20,
  studioCanvasFontFamily: token('font'),

  // Widgets are white cards with a hairline edge on the grey canvas, like the other pages' cards.
  studioWidgetBackgroundColor: token('surface'),
  studioWidgetBorder: line('border'),
  studioWidgetBorderRadius: 8,
  studioWidgetPadding: 18,
  studioWidgetTitleFontFamily: token('font'),
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token('ink'),
  studioWidgetSubtitleFontFamily: token('font'),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token('muted'),
  studioWidgetCaptionFontFamily: token('font'),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token('muted'),
  studioWidgetResizeBorderColor: token('blue'),
  studioWidgetToolbarBackgroundColor: token('surface'),
  studioWidgetToolbarBorder: line('border'),
  studioWidgetToolbarButtonColor: token('muted'),
  studioWidgetToolbarButtonHoverBackgroundColor: token('highlight'),
  studioWidgetLoadingOverlayBackgroundColor: token('surface'),
  studioWidgetNoDataOverlayBackgroundColor: token('surface'),

  // Edit-mode panels: white, like the widgets.
  studioPanelContainerBackgroundColor: token('surface'),
  studioPanelContainerBorder: line('border'),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token('border'),
  studioPanelDividerActiveColor: token('blue'),
  studioPanelSectionBorderColor: token('border'),
  studioPanelHeaderFontFamily: token('font'),
  studioPanelHeaderFontWeight: 600,
  studioPanelGroupBackgroundColor: token('canvas'),
  studioPanelGroupTitleBarTextColor: token('ink'),
  studioFormLabelColor: token('muted'),
  studioAiPanelInputMessageBackgroundColor: token('canvas'),
  studioAiPanelButtonHoverBackgroundColor: token('highlight'),
  studioAiPanelRichTextAccentBackgroundColor: token('highlight'),
  studioFieldSelectSelectedBackgroundColor: token('highlight'),
  studioDragAndDropImageBackgroundColor: token('surface'),
  studioDragAndDropImageTextColor: token('ink'),
  studioPanelChevronButtonHoverBackgroundColor: token('highlight'),
  studioPanelChevronButtonHoverColor: token('blue'),
  // Selected toggles (the agent switch): pale blue fill, PayPal blue edge and text.
  studioToggleButtonActiveBackgroundColor: token('highlight'),
  studioToggleButtonActiveBorderColor: token('blue'),
  studioToggleButtonActiveColor: token('blue'),

  // Grid widgets: muted semibold headers, faint dividers, roomy rows.
  gridFontFamily: token('font'),
  gridFontSize: 14,
  gridCellTextColor: token('ink'),
  gridHeaderBackgroundColor: token('surface'),
  gridHeaderTextColor: token('muted'),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 40,
  gridRowBorder: line('gridline'),
  gridHeaderRowBorder: line('border'),
  gridPinnedRowBorder: line('border'),
  gridRowHoverColor: token('highlight'),
  gridWrapperBorder: false,

  // Charts.
  chartFontFamily: token('font'),
  chartTextColor: token('ink'),
  chartSubtleTextColor: token('muted'),
  chartAxisLineColor: token('border'),
  chartGridLineColor: token('gridline'),
  chartTooltipBackgroundColor: token('surface'),
  chartTooltipTextColor: token('ink'),
  chartTooltipSubtleTextColor: token('muted'),
  chartTooltipBorder: line('border'),
  chartCrosshairLabelBackgroundColor: token('ink'),
  chartCrosshairLabelTextColor: token('surface'),
  ...palette,
});
