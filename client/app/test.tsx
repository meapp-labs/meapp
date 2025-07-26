import '@/global.css';
import {
    TextInput,
    Pressable,
    Text,
    View,
    TouchableOpacity,
} from 'react-native';
import { Check, EyeOff, Eye } from 'lucide-react-native';
import { useState } from 'react';

export default function Test() {
    const [checkboxPressed, setCheckboxPressed] = useState(false);
    const [passwordPressedVisible, setPasswordVisible] = useState(false);

    return (
        <View className="flex-1 items-center justify-center bg-[#121212]">
            <View className="p-4 border rounded-lg border-[#414141] w-full sm:w-3/4 md:w-1/2 lg:w-[450px]">
                <Text className="text-xl font-bold text-[#d4d4d4] pb-1">
                    Login to your account
                </Text>
                <View className="flex-row pb-4">
                    <Text className="pr-1 text-[#d4d4d4]">
                        Don't have an account?
                    </Text>
                    <Pressable>
                        <Text className="text-[#d4d4d4] hover:text-sky-500">
                            Sign up
                        </Text>
                    </Pressable>
                </View>
                <Text className="text-base text-[#d4d4d4] pb-2">Email</Text>
                <TextInput
                    placeholderTextColor="#8c8c8c"
                    placeholder="abc@gmail.com"
                    className="p-2 text-[#d4d4d4] rounded-md border border-[#414141]"
                />
                <View style={{ position: 'relative', width: '100%' }}>
                    <Text className="text-base text-[#d4d4d4] pb-2 pt-4">
                        Password
                    </Text>
                    <TextInput
                        secureTextEntry={passwordPressedVisible ? false : true}
                        placeholderTextColor="#8c8c8c"
                        placeholder="Enter password"
                        className="p-2 text-[#d4d4d4] rounded-md border border-[#414141]"
                    />
                    <Pressable
                        style={{
                            position: 'absolute',
                            top: '68%',
                            left: '92%',
                        }}
                        onPressIn={() => setPasswordVisible((prev) => !prev)}
                    >
                        {passwordPressedVisible ? (
                            <Eye color="white" size={18} />
                        ) : (
                            <EyeOff color="white" size={18} />
                        )}
                    </Pressable>
                </View>
                <View className="flex-row pb-5 pt-4">
                    <View className="flex-row justify-between w-full">
                        <Pressable
                            className="flex-row group"
                            onPressIn={() =>
                                setCheckboxPressed((prev) => !prev)
                            }
                        >
                            <View className="group-hover:border-neutral-300 self-center border-2 rounded-md border-[#a3a3a3] w-[16px] h-[16px]">
                                <Check
                                    color="white"
                                    size={12}
                                    opacity={checkboxPressed ? 1 : 0}
                                />
                            </View>
                            <Text
                                selectable={false}
                                className="group-hover:text-neutral-200 pl-1 text-[#d4d4d4]"
                            >
                                Remember me
                            </Text>
                        </Pressable>
                        <View>
                            <Pressable className="flex-r">
                                <Text className="text-[#d4d4d4] hover:text-sky-500">
                                    Forgot password?
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
                <TouchableOpacity className="p-2 rounded-md bg-[#d9d9db]">
                    <Text className="text-base text-center font-semibold">
                        Login
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
