import { useState } from 'react';
import { Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { loginUser, logoutUser, registerUser } from '@/services/auth';
import { set } from 'react-hook-form';

export default function Query() {
    const [loggedIn, setLoggedIn] = useState('nobody logged in');
    const [loginSuccess, setLoginSuccess] = useState(false);
    const [username, setUsername] = useState('');
    const [pass, setPass] = useState('');
    const [isEnabled, setIsEnabled] = useState(true);
    const toggleSwitch = () =>
        setIsEnabled((previousState) => {
            setUsername('');
            setPass('');
            return !previousState;
        });

    const userData = {
        username,
        pass,
    };

    const handleRegisterSubmit = async () => {
        try {
            const response = await registerUser(userData);
            console.log('Succes: ', response);
        } catch (error) {
            console.log('Error: ', error);
        }
    };

    const handleLoginSubmit = async () => {
        try {
            const response = await loginUser(userData);
            if (response.status === 'logged_in') {
                setLoggedIn(username);
                setLoginSuccess(true);
            }
            console.log('Success: ', response);
        } catch (error) {
            setLoggedIn('nobody logged in');
            setLoginSuccess(false);
            console.log('Error: ', error);
        }
    };

    const handleLogout = async () => {
        try {
            const response = await logoutUser();
            if (response.status === 'logged_out') {
                setLoggedIn('nobody logged in');
                setLoginSuccess(false);
            }
            console.log('Success: ', response);
        } catch (error) {
            console.log('Error: ', error);
        }
    };

    return (
        <View className="w-full h-[95%] gap-2">
            <View className="h-full flex-row">
                <View className="self-center gap-4 w-1/2">
                    <View className="flex-row self-center gap-1">
                        <Text className="color-zinc-300 font-semibold">
                            Currently logged in:
                        </Text>
                        <Text
                            className={
                                loginSuccess
                                    ? 'font-semibold color-green-500'
                                    : 'font-semibold color-rose-800'
                            }
                        >
                            {loggedIn}
                        </Text>
                    </View>
                    <View className="self-center flex-row gap-2">
                        {isEnabled ? (
                            <View className="flex border-dashed border border-emerald-500 p-2 rounded-md gap-2">
                                <Text className="text-lg text-center bg-emerald-500">
                                    Register
                                </Text>
                                <Text className="font-sm color-zinc-300">
                                    Username
                                </Text>
                                <TextInput
                                    value={username}
                                    onChangeText={setUsername}
                                    placeholder="John Messenger"
                                    placeholderTextColor={'gray'}
                                    className="border rounded-md border-zinc-600 hover:border-zinc-300 p-2 color-zinc-300"
                                />
                                <Text className="font-sm color-zinc-300">
                                    Password
                                </Text>
                                <TextInput
                                    secureTextEntry={false}
                                    value={pass}
                                    onChangeText={setPass}
                                    placeholder="Enter password"
                                    placeholderTextColor={'gray'}
                                    className="border rounded-md border-zinc-600 hover:border-zinc-300 p-2 color-zinc-300"
                                />
                                <TouchableOpacity
                                    className="self-center hover:bg-zinc-100 w-1/2 bg-zinc-300 rounded-md p-1"
                                    onPress={handleRegisterSubmit}
                                >
                                    <Text className="text-center font-semibold text-sm">
                                        Confirm
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View className="flex border-dashed border border-sky-600 p-2 rounded-md gap-2">
                                <Text className="text-lg text-center bg-sky-600">
                                    Login
                                </Text>
                                <Text className="font-sm color-zinc-300">
                                    Username
                                </Text>
                                <TextInput
                                    value={username}
                                    onChangeText={setUsername}
                                    placeholder="John Messenger"
                                    placeholderTextColor={'gray'}
                                    className="border rounded-md border-zinc-600 hover:border-zinc-300 p-2 color-zinc-300"
                                />
                                <Text className="font-sm color-zinc-300">
                                    Password
                                </Text>
                                <TextInput
                                    value={pass}
                                    onChangeText={setPass}
                                    placeholder="Enter password"
                                    placeholderTextColor={'gray'}
                                    className="border rounded-md border-zinc-600 hover:border-zinc-300 p-2 color-zinc-300"
                                />
                                <View className="flex-row gap-2 justify-center">
                                    <TouchableOpacity
                                        className="w-auto hover:bg-zinc-100 bg-zinc-300 rounded-md p-1 px-5"
                                        onPress={handleLoginSubmit}
                                    >
                                        <Text className="text-center font-semibold text-sm ">
                                            Confirm
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        className="w-auto bg-rose-900 hover:bg-rose-800 rounded-md p-1 px-5"
                                        onPress={handleLogout}
                                    >
                                        <Text className="font-semibold text-center text-sm color-white">
                                            Logout
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                    <View className="flex-row self-center gap-2">
                        <Text className="font-semibold text-sky-600">
                            Login
                        </Text>
                        <Switch
                            value={isEnabled}
                            trackColor={{
                                false: '#4daedfff',
                                true: '#41daa7ff',
                            }}
                            thumbColor={isEnabled ? '#10b981' : '#0284c7'}
                            onValueChange={toggleSwitch}
                            className="self-center w-full"
                        />
                        <Text className="font-semibold text-emerald-500">
                            Register
                        </Text>
                    </View>
                </View>

                <View className="w-1/2 h-[95%] self-end justify-end items-center border-l b border-zinc-600">
                    <View className="flex-row gap-2 mb-">
                        <TextInput
                            placeholder="Enter message"
                            placeholderTextColor={'#52525b'}
                            className="border border-zinc-600 pr-64 rounded-md p-2 h-full hover:border-zinc-300 text-zinc-300"
                        />
                        <TouchableOpacity className="p-2 px-5 rounded-md bg-zinc-300 hover:bg-zinc-100">
                            <Text className="font-semibold text-sm text-center">
                                Send
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </View>
    );
}
