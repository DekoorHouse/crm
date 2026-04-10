import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { type AppModule } from "../constants/modules";

interface Props {
  module: AppModule;
  onPress: () => void;
}

export default function ModuleCard({ module, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.iconContainer, { backgroundColor: module.color + "18" }]}>
        <Feather
          name={module.icon as any}
          size={26}
          color={module.color}
        />
      </View>
      <Text style={styles.name} numberOfLines={1}>{module.name}</Text>
      <Text style={styles.description} numberOfLines={1}>{module.description}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    width: "47%",
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
  iconContainer: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1C1E",
    marginBottom: 2,
  },
  description: {
    fontSize: 12,
    color: "#6B7280",
  },
});
