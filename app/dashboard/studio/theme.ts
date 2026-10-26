// AG Studio theme for the PayPal dashboard. Every value points at a design token from
// app/globals.css, the same variables the shell's Tailwind classes use, so Studio renders as
// part of the page rather than a component embedded in it: change a token there and the shell,
// widgets, grids and charts all follow.

import { studioTheme } from 'ag-studio';

const token = (name: string) => `var(--pp-${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

// Studio colours series by position: the first measure (or legend value) of a chart takes colour 1,
// the second colour 2 and so on, and a chart can't pick its own. So the palette starts with the
// guard's verdicts, which the guard charts plot as measures in this order: allowed green, held
// amber, blocked red. PayPal's blues follow for everything else.
const SERIES = [
  token('success'),
  token('chart-4'),
  token('danger'),
  token('blue'),
  token('navy'),
  token('chart-3'),
  token('chart-5'),
  token('chart-7'),
  token('chart-6'),
  token('sky'),
];

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
  accentColor: token('blue'),
  iconColor: token('navy'),
  rowHoverColor: token('highlight'),

  // No frame: the canvas is the page's own background. Each widget is inset 12px inside its
  // grid cell, so 20px of padding puts widget edges on the header's 32px gutter.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token('canvas'),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token('canvas'),
  studioCanvasPadding: 20,
  // Taller rows than the default 16px make room for roomy cards.
  studioCanvasRowHeight: 20,
  studioCanvasFontFamily: token('font'),

  // Widgets are the shell's cards: white, 1px border, 12px radius, generous padding.
  studioWidgetBackgroundColor: token('surface'),
  studioWidgetBorder: line('border'),
  studioWidgetBorderRadius: 12,
  studioWidgetPadding: 18,
  studioWidgetTitleFontFamily: token('font'),
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token('navy'),
  studioWidgetSubtitleFontFamily: token('font'),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token('muted'),
  studioWidgetCaptionFontFamily: token('font'),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token('muted'),
  studioWidgetResizeBorderColor: token('blue'),

  // Edit-mode panels read as more of the sidebar.
  studioPanelContainerBackgroundColor: token('surface'),
  studioPanelContainerBorder: line('border'),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token('border'),
  studioPanelDividerActiveColor: token('blue'),
  studioPanelSectionBorderColor: token('border'),
  studioPanelHeaderFontFamily: token('font'),
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token('highlight'),
  studioPanelChevronButtonHoverColor: token('blue'),
  // Selected toggles match the sidebar's selected item: highlight fill, blue text and edge.
  studioToggleButtonActiveBackgroundColor: token('highlight'),
  studioToggleButtonActiveBorderColor: token('blue'),
  studioToggleButtonActiveColor: token('blue'),

  // Grid widgets: muted semibold headers, light dividers, roomy rows.
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
  ...palette,
});
