import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Colors } from "../src/constants/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" backgroundColor={Colors.primary} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
        }}
      />
    </>
  );
}
