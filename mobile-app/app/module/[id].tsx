import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { MODULES } from "../../src/constants/modules";
import WebViewScreen from "../../src/components/WebViewScreen";
import { Colors } from "../../src/constants/theme";

export default function ModuleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const mod = MODULES.find((m) => m.id === id);

  if (!mod) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>Modulo no encontrado</Text>
      </View>
    );
  }

  return (
    <WebViewScreen
      url={mod.url}
      title={mod.name}
      color={mod.color}
      onBack={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
  notFoundText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
});
