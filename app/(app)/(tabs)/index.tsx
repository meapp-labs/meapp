import FriendsScreen from '@/components/FriendsScreen';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import Toolbar from '@/components/Toolbar';
import { Colors } from '@/constants/Colors';
import { Button } from '@react-navigation/elements';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const mockMessages = [
  { id: '1', text: 'Hello!', sender: 'them' },
  { id: '2', text: 'Hi there!', sender: 'me' },
  { id: '3', text: 'How are you?', sender: 'them' },
  { id: '4', text: 'I am good, thanks! And you?', sender: 'me' },
  { id: '5', text: 'I am doing great!', sender: 'them' },
  { id: '6', text: 'That is great to hear', sender: 'me' },
  {
    id: '7',
    text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    sender: 'them',
  },
  {
    id: '8',
    text: 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    sender: 'me',
  },
  {
    id: '9',
    text: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    sender: 'them',
  },
  {
    id: '10',
    text: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
    sender: 'me',
  },
];

export default function ChatScreen() {
  const [messages, setMessages] = useState(mockMessages);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);


  const handleSend = () => {
    if (inputText.trim().length > 0) {
      const newMessage = {
        id: (messages.length + 1).toString(),
        text: inputText,
        sender: 'me',
      };
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMessages([...messages, newMessage]);
      setInputText('');
    }
  };

  useEffect(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const renderMessage = ({
    item,
  }: { item: { id: string; text: string; sender: string } }) => (
    <View
      style={[
        styles.messageContainer,
        item.sender === 'me'
          ? styles.myMessageContainer
          : styles.theirMessageContainer,
      ]}
    >
      <ThemedText
        style={item.sender === 'me' ? styles.myMessageText : undefined}
      >
        {item.text}
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={[styles.container, {
      flexDirection: 'row'

    }]}>
      <View style={{ flex: 1, borderRightColor:'#2c2c2e', borderRightWidth: 1 }}>
        <FriendsScreen />
        
        {/*Mock logout button*/}
        <Button style={{margin: 10, alignItems:'center', justifyContent:'center'}} onPress={() => router.navigate('/sign-in')}>Logout</Button>
      
      </View>
  
      <View style={{ flex: 5 }}>
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Type a message..."
              placeholderTextColor="#9BA1A6"
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
      <View>
        <Toolbar/>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  messageContainer: {
    borderRadius: 20,
    padding: 15,
    marginVertical: 5,
    maxWidth: '80%',
  },
  myMessageContainer: {
    backgroundColor: '#007AFF',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 5,
  },
  theirMessageContainer: {
    backgroundColor: '#2C2C2E',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 5,
  },
  myMessageText: {
    color: '#fff',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#2C2C2E',
  },
  input: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    color: Colors.text,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});