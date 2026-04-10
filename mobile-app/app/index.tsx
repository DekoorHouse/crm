import { useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { MODULES, CATEGORIES } from "../src/constants/modules";
import { Colors } from "../src/constants/theme";
import ModuleCard from "../src/components/ModuleCard";

export default function HomeScreen() {
  const router = useRouter();

  const openModule = (moduleId: string) => {
    router.push(`/module/${moduleId}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Dekoor</Text>
          <Text style={styles.subtitle}>Panel del equipo</Text>
        </View>
        <View style={styles.logo}>
          <Feather name="hexagon" size={28} color={Colors.textOnPrimary} />
        </View>
      </View>

      {/* Module Grid */}
      <FlatList
        data={CATEGORIES}
        keyExtractor={(cat) => cat.key}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: category }) => {
          const categoryModules = MODULES.filter(
            (m) => m.category === category.key
          );
          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{category.label}</Text>
              <View style={styles.grid}>
                {categoryModules.map((mod) => (
                  <ModuleCard
                    key={mod.id}
                    module={mod}
                    onPress={() => openModule(mod.id)}
                  />
                ))}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  greeting: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.textOnPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    minHeight: "100%",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 12,
    marginLeft: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
});
