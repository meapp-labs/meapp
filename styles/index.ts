import { StyleSheet } from 'react-native';

import { Colors } from '../constants/Colors';

export default StyleSheet.create({
    //=============== FriendsScreen.tsx
    friendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 5,
        borderRadius: 10,
        marginHorizontal: 10,
        marginVertical: 5,
    },
    avatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        marginRight: 15,
        marginLeft: 15,
    },
    friendName: {
        fontSize: 15,
    },
    friendItemHovered: {
        backgroundColor: '#2C2C2E',
    },
    friendItemPressed: {
        backgroundColor: '#49494d',
    },
    //=============== Toolbar.tsx
    toolbarContainer: {
        gap: 10,
        padding: 10,
        flexDirection: 'column-reverse',
        flex: 1,
        borderLeftWidth: 1,
        borderColor: '#2c2c2e',
    },
    //=============== sign-in.tsx, sign-up.tsx
    formContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        borderStartWidth: 1,
        borderEndWidth: 1,
        borderColor: '#2c2c2e',
        borderRadius: 25,
        paddingHorizontal: 20,
        paddingVertical: 25,
    },
    input: {
        color: '#fff',
        padding: 15,
        marginBottom: 15,
        borderRadius: 10,
        backgroundColor: '#2C2C2E',
    },
    signButton: {
        marginTop: 5,
        padding: 10,
    },
    //=============== index.tsx
    statusBar: {
        padding: 10,
        backgroundColor: '#1C1C1E',
        alignItems: 'center',
    },
    statusText: {
        color: '#9BA1A6',
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
    messageInput: {
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
    //=============== +not-found.tsx
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
    link: {
        marginTop: 15,
        paddingVertical: 15,
    },
});
