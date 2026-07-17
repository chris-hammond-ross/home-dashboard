import { createTheme, type MantineColorsTuple } from "@mantine/core";

/** Brand blue anchored on the palette's dark categorical slot 1 (#3987e5). */
const brand: MantineColorsTuple = [
  "#e7f1fd",
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#4f93e9",
  "#3987e5",
  "#2a78d6",
  "#256abf",
  "#1c5cab",
  "#104281",
];

export const theme = createTheme({
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 5 },
  colors: { brand },
  defaultRadius: "lg",
  components: {
    Card: {
      defaultProps: { radius: 16, padding: "lg" },
      styles: {
        root: {
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--hairline)",
        },
      },
    },
  },
});
